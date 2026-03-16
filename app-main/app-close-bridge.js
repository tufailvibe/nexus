function escapeForJavaScriptSingleQuoted(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function createAppCloseBridge({ getMainWindow }) {
  async function invokeRendererSell(methodName, argumentLiteral = '') {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return null;

    const script = `
      (async () => {
        try {
          if (typeof Sell === 'undefined' || !Sell || typeof Sell.${methodName} !== 'function') {
            return null;
          }
          return await Sell.${methodName}(${argumentLiteral});
        } catch (error) {
          return {
            success: false,
            error: String(error && error.message ? error.message : error || 'Renderer close handler failed.')
          };
        }
      })();
    `;

    return mainWindow.webContents.executeJavaScript(script, true);
  }

  async function getRendererAppCloseState() {
    const result = await invokeRendererSell('getAppCloseState');
    return result && typeof result === 'object'
      ? result
      : { hasPending: false, pendingViews: [], dirtyViews: [], recoveryViews: [], summary: '' };
  }

  async function finalizeRendererAppClose(action) {
    const argumentLiteral = `'${escapeForJavaScriptSingleQuoted(action)}'`;
    const result = await invokeRendererSell('finalizeAppClose', argumentLiteral);
    if (result && result.success === false) {
      throw new Error(result.error || 'App close could not be completed.');
    }
    return result || { success: true };
  }

  return {
    getRendererAppCloseState,
    finalizeRendererAppClose
  };
}

module.exports = {
  createAppCloseBridge
};
