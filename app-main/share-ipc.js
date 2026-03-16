const fs = require('fs');
const { execFile } = require('child_process');

const ALLOWED_EXTERNAL_HOSTS = new Set(['wa.me', 'mail.google.com']);

function isAllowedExternalUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    return parsed.protocol === 'https:' && ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname);
  } catch (_) {
    return false;
  }
}

function isAllowedWhatsappProtocolUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    return parsed.protocol === 'whatsapp:' && parsed.hostname === 'send';
  } catch (_) {
    return false;
  }
}

function toPowerShellSingleQuoted(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function executePowerShell(script, timeoutMs = 30000) {
  const candidates = ['powershell.exe', 'pwsh.exe'];

  return new Promise((resolve, reject) => {
    const tryCommand = (index, lastError) => {
      if (index >= candidates.length) {
        reject(lastError || new Error('Windows PowerShell is not available.'));
        return;
      }

      execFile(
        candidates[index],
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        {
          windowsHide: true,
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024
        },
        (error, stdout, stderr) => {
          if (error && error.code === 'ENOENT') {
            tryCommand(index + 1, error);
            return;
          }

          if (error) {
            const details = String(stderr || stdout || error.message || '').trim();
            reject(new Error(details || 'PowerShell execution failed.'));
            return;
          }

          resolve({
            stdout: String(stdout || ''),
            stderr: String(stderr || '')
          });
        }
      );
    };

    tryCommand(0, null);
  });
}

function parsePowerShellJsonResult(stdout) {
  const raw = String(stdout || '').trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch (_) {
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const candidate = lines.length ? lines[lines.length - 1] : '';
    return candidate ? JSON.parse(candidate) : {};
  }
}

function buildShareAutomationScript({ channel, filePath, targetUrl, fallbackUrl = '' }) {
  const titleCandidates = channel === 'gmail'
    ? ['Gmail', 'New Message']
    : ['WhatsApp'];
  const titleList = `@(${titleCandidates.map(toPowerShellSingleQuoted).join(', ')})`;
  const openTargetStatements = channel === 'whatsapp'
    ? `
$openTargets = @(
  [PSCustomObject]@{ Url = ${toPowerShellSingleQuoted(targetUrl)}; Label = 'desktop' },
  [PSCustomObject]@{ Url = ${toPowerShellSingleQuoted(fallbackUrl)}; Label = 'web' }
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_.Url) }
foreach ($entry in $openTargets) {
  try {
    Start-Process -FilePath $entry.Url -ErrorAction Stop | Out-Null
    $openedUrl = $entry.Url
    $openedTarget = $entry.Label
    break
  } catch {
    $openErrors += $_.Exception.Message
  }
}
if (-not $openedUrl) {
  throw ('Unable to open the WhatsApp share target. ' + ($openErrors -join ' | '))
}`
    : `
Start-Process -FilePath ${toPowerShellSingleQuoted(targetUrl)} -ErrorAction Stop | Out-Null
$openedUrl = ${toPowerShellSingleQuoted(targetUrl)}
$openedTarget = 'gmail'`;

  return `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct RECT {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}
public struct POINT {
  public int X;
  public int Y;
}
public static class ShareWindowNative {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
}
"@

function Set-ShareClipboardFile([string]$Path) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Collections
  $lastError = $null
  for ($attempt = 0; $attempt -lt 6; $attempt += 1) {
    try {
      [System.Windows.Forms.Clipboard]::Clear()
      Start-Sleep -Milliseconds 120
      $files = New-Object System.Collections.Specialized.StringCollection
      [void]$files.Add($Path)
      [System.Windows.Forms.Clipboard]::SetFileDropList($files)
      Start-Sleep -Milliseconds 120
      if ([System.Windows.Forms.Clipboard]::ContainsFileDropList()) {
        return
      }
    } catch {
      $lastError = $_
      Start-Sleep -Milliseconds 220
    }
  }

  if ($lastError) {
    throw $lastError
  }
  throw 'Could not copy the PDF file to the Windows clipboard.'
}

function Focus-ShareWindow([string[]]$Titles, [int]$TimeoutMs) {
  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline) {
    $windows = Get-Process | Where-Object {
      $_.MainWindowHandle -ne 0 -and -not [string]::IsNullOrWhiteSpace($_.MainWindowTitle)
    }

    foreach ($title in $Titles) {
      $match = $windows | Where-Object { $_.MainWindowTitle -like ('*' + $title + '*') } | Select-Object -First 1
      if ($match) {
        [void][ShareWindowNative]::ShowWindowAsync($match.MainWindowHandle, 9)
        Start-Sleep -Milliseconds 150
        [void][ShareWindowNative]::SetForegroundWindow($match.MainWindowHandle)
        Start-Sleep -Milliseconds 450
        return [PSCustomObject]@{
          Success = $true
          Title = $match.MainWindowTitle
          Handle = [int64]$match.MainWindowHandle
        }
      }
    }

    Start-Sleep -Milliseconds 450
  }

  return [PSCustomObject]@{
    Success = $false
    Title = ''
    Handle = [int64]0
  }
}

function Click-ShareInputArea([int64]$Handle, [string]$Channel) {
  if ($Handle -le 0) {
    return $false
  }

  if ($Channel -eq 'whatsapp') {
    return Click-ShareWindowPoint -Handle $Handle -XRatio 0.50 -YRatio 0.92 -PauseMs 220
  }

  return Click-ShareWindowPoint -Handle $Handle -XRatio 0.45 -YRatio 0.38 -PauseMs 220
}

function Click-ShareWindowPoint([int64]$Handle, [double]$XRatio, [double]$YRatio, [int]$PauseMs) {
  if ($Handle -le 0) {
    return $false
  }

  $rect = New-Object RECT
  if (-not [ShareWindowNative]::GetWindowRect([IntPtr]::new($Handle), [ref]$rect)) {
    return $false
  }

  $width = [Math]::Max(1, $rect.Right - $rect.Left)
  $height = [Math]::Max(1, $rect.Bottom - $rect.Top)
  $x = [int]($rect.Left + ($width * $XRatio))
  $y = [int]($rect.Top + ($height * $YRatio))
  $previousPoint = New-Object POINT
  [void][ShareWindowNative]::GetCursorPos([ref]$previousPoint)
  [void][ShareWindowNative]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 140
  [ShareWindowNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [ShareWindowNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds ([Math]::Max(80, $PauseMs))
  [void][ShareWindowNative]::SetCursorPos($previousPoint.X, $previousPoint.Y)
  return $true
}

function Send-SharePaste() {
  $VK_CONTROL = 0x11
  $VK_V = 0x56
  $KEYEVENTF_KEYUP = 0x0002
  [ShareWindowNative]::keybd_event($VK_CONTROL, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 55
  [ShareWindowNative]::keybd_event($VK_V, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 55
  [ShareWindowNative]::keybd_event($VK_V, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 55
  [ShareWindowNative]::keybd_event($VK_CONTROL, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
}

function Send-ShareEnter() {
  $VK_RETURN = 0x0D
  $KEYEVENTF_KEYUP = 0x0002
  [ShareWindowNative]::keybd_event($VK_RETURN, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 55
  [ShareWindowNative]::keybd_event($VK_RETURN, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
}

function Set-ClipboardText([string]$Text) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.Clipboard]::SetText($Text)
}

function Try-WhatsappDesktopAttach([int64]$Handle, [string]$Path) {
  if ($Handle -le 0) {
    return $false
  }

  if (-not (Click-ShareWindowPoint -Handle $Handle -XRatio 0.030 -YRatio 0.915 -PauseMs 380)) {
    return $false
  }

  if (-not (Click-ShareWindowPoint -Handle $Handle -XRatio 0.120 -YRatio 0.760 -PauseMs 950)) {
    return $false
  }

  $dialogResult = Focus-ShareWindow -Titles @('Open', 'File Upload', 'Select file', 'Choose file') -TimeoutMs 7000
  if (-not $dialogResult.Success) {
    return $false
  }

  Set-ClipboardText -Text $Path
  Start-Sleep -Milliseconds 180
  Send-SharePaste
  Start-Sleep -Milliseconds 260
  Send-ShareEnter
  Start-Sleep -Milliseconds 1600

  $whatsAppResult = Focus-ShareWindow -Titles @('WhatsApp') -TimeoutMs 8000
  if (-not $whatsAppResult.Success) {
    return $false
  }

  return Click-ShareWindowPoint -Handle $whatsAppResult.Handle -XRatio 0.930 -YRatio 0.965 -PauseMs 420
}

$shareResult = [ordered]@{
  clipboardReady = $false
  openedUrl = ''
  openedTarget = ''
  windowFocused = $false
  focusTitle = ''
  autoPasted = $false
  autoPasteError = ''
}
$openErrors = @()
$openedUrl = ''
$openedTarget = ''

Set-ShareClipboardFile -Path ${toPowerShellSingleQuoted(filePath)}
$shareResult.clipboardReady = $true

${openTargetStatements}

$shareResult.openedUrl = $openedUrl
$shareResult.openedTarget = $openedTarget

$focusResult = Focus-ShareWindow -Titles ${titleList} -TimeoutMs 15000
if ($focusResult.Success) {
  $shareResult.windowFocused = $true
  $shareResult.focusTitle = $focusResult.Title
  try {
    if (-not (Click-ShareInputArea -Handle $focusResult.Handle -Channel ${toPowerShellSingleQuoted(channel)})) {
      throw 'Unable to focus the message composer.'
    }
    Start-Sleep -Milliseconds 180
    if (${channel === 'whatsapp' ? '$openedTarget -eq \'desktop\'' : '$false'}) {
      if (-not (Try-WhatsappDesktopAttach -Handle $focusResult.Handle -Path ${toPowerShellSingleQuoted(filePath)})) {
        throw 'WhatsApp Desktop file attach automation did not complete.'
      }
      $shareResult.autoPasted = $true
    } else {
      Send-SharePaste
      Start-Sleep -Milliseconds 520
      if (${channel === 'gmail' ? '$true' : '$false'}) {
        Send-ShareEnter
      }
      $shareResult.autoPasted = $true
    }
  } catch {
    $shareResult.autoPasteError = $_.Exception.Message
  }
}

$shareResult | ConvertTo-Json -Compress
`;
}

function registerShareIpc({
  ipcMain,
  shell,
  normalizeFsPath,
  canRendererAccessPath,
  isHeadlessRuntime
}) {
  ipcMain.handle('open-external-url', async (_event, rawUrl) => {
    try {
      if (!isAllowedExternalUrl(rawUrl)) {
        throw new Error('Unsupported external URL.');
      }
      await shell.openExternal(String(rawUrl));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('start-auto-share', async (_event, payload = {}) => {
    try {
      const channel = payload.channel === 'whatsapp' ? 'whatsapp' : payload.channel === 'gmail' ? 'gmail' : '';
      if (!channel) {
        throw new Error('Unsupported share channel.');
      }

      const filePath = normalizeFsPath(payload.filePath);
      if (!filePath || !fs.existsSync(filePath)) {
        throw new Error('The selected PDF file could not be found.');
      }
      if (!canRendererAccessPath(filePath, 'read') && !canRendererAccessPath(filePath, 'write')) {
        throw new Error('Access denied for the selected PDF file.');
      }

      const targetUrl = String(payload.targetUrl || '');
      const fallbackUrl = String(payload.fallbackUrl || '');
      if (channel === 'gmail') {
        if (!isAllowedExternalUrl(targetUrl)) {
          throw new Error('Unsupported Gmail share target.');
        }
      } else {
        if (!isAllowedWhatsappProtocolUrl(targetUrl)) {
          throw new Error('Unsupported WhatsApp share target.');
        }
        if (fallbackUrl && !isAllowedExternalUrl(fallbackUrl)) {
          throw new Error('Unsupported WhatsApp fallback target.');
        }
      }

      if (isHeadlessRuntime) {
        const headlessUrl = channel === 'whatsapp' ? (fallbackUrl || targetUrl) : targetUrl;
        await shell.showItemInFolder(filePath);
        await shell.openExternal(headlessUrl);
        return {
          success: true,
          clipboardReady: true,
          filePath,
          openedUrl: headlessUrl,
          openedTarget: channel === 'whatsapp' ? 'web' : 'gmail',
          windowFocused: channel !== 'whatsapp',
          autoPasted: channel !== 'whatsapp',
          autoPasteError: ''
        };
      }

      const script = buildShareAutomationScript({
        channel,
        filePath,
        targetUrl,
        fallbackUrl
      });
      const result = parsePowerShellJsonResult((await executePowerShell(script)).stdout);
      return {
        success: true,
        clipboardReady: result.clipboardReady !== false,
        openedUrl: String(result.openedUrl || ''),
        openedTarget: String(result.openedTarget || ''),
        windowFocused: !!result.windowFocused,
        focusTitle: String(result.focusTitle || ''),
        autoPasted: !!result.autoPasted,
        autoPasteError: String(result.autoPasteError || '')
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('show-item-in-folder', async (_event, filePath) => {
    try {
      const normalized = normalizeFsPath(filePath);
      if (!normalized) {
        throw new Error('A file path is required.');
      }
      if (!canRendererAccessPath(normalized, 'read') && !canRendererAccessPath(normalized, 'write')) {
        throw new Error('Access denied for the requested file.');
      }
      shell.showItemInFolder(normalized);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  registerShareIpc
};
