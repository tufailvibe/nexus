function normalizeImportedPayload(payload, label) {
  if (typeof payload === 'string') {
    JSON.parse(payload);
    return payload;
  }

  if (payload && typeof payload === 'object') {
    return JSON.stringify(payload);
  }

  throw new Error(`Invalid ${label} payload.`);
}

function toInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePackQtyText(packQtyText) {
  return String(packQtyText || '')
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 1632))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 1776))
    .replace(/\uFF0B/g, '+')
    .replace(/\uFF0D/g, '-')
    .replace(/\uFF0C/g, ',');
}

function parsePackQtyValue(packQtyText) {
  const match = normalizePackQtyText(packQtyText)
    .replace(/,/g, '')
    .match(/[+-]?\d+/);
  if (!match) return null;

  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function setPackQtyValue(packQtyText, qtyValue) {
  const source = String(packQtyText || '');
  const normalizedSource = normalizePackQtyText(source);
  const safeQty = Math.max(0, toInteger(qtyValue));
  const match = normalizedSource.match(/[+-]?\d+/);

  if (!match) {
    const trimmed = source.trim();
    if (!trimmed) return String(safeQty);
    return `${safeQty} ${trimmed}`;
  }

  const start = match.index || 0;
  const end = start + match[0].length;
  return `${source.slice(0, start)}${safeQty}${source.slice(end)}`;
}

function resolvePackQtyText(packQtyText, stockQty) {
  const source = typeof packQtyText === 'string' ? packQtyText : '';
  if (source.trim() !== '') {
    return source;
  }

  if (stockQty !== undefined && stockQty !== null) {
    return setPackQtyValue(source, stockQty);
  }

  return source;
}

function deriveStockQty(packQtyText) {
  const parsed = parsePackQtyValue(packQtyText);
  return Math.max(0, parsed == null ? 0 : parsed);
}

function registerImportIpc({
  ipcMain,
  getDB,
  resultToObject,
  saveDBToDisk
}) {
  async function importAllDataPayload(data) {
    if (!data || typeof data !== 'object' || !data.version) {
      throw new Error('Invalid backup data');
    }

    const database = await getDB();
    database.exec('BEGIN');

    try {
      if (Array.isArray(data.settings)) {
        for (const setting of data.settings) {
          database.run(
            'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
            [String(setting.key || ''), String(setting.value ?? '')]
          );
        }
      }

      if (Array.isArray(data.products)) {
        for (const product of data.products) {
          const packQtyText = resolvePackQtyText(product.pack_qty_text, product.stock_qty);
          const stockQty = deriveStockQty(packQtyText);
          const existing = resultToObject(
            database.exec('SELECT id FROM products WHERE barcode = ?', [product.barcode])
          );

          if (existing) {
            database.run(
              `UPDATE products SET name_en=?, name_ar=?, country=?, weight=?, unit_price_fils=?,
               product_by=?, pack_qty_text=?, stock_qty=?, reorder_level=?, display_order=?, archived_at=?, updated_at=datetime('now') WHERE barcode=?`,
              [
                product.name_en || '',
                product.name_ar || '',
                product.country || '',
                product.weight || '',
                toInteger(product.unit_price_fils),
                product.product_by || '',
                packQtyText,
                stockQty,
                toInteger(product.reorder_level, 5),
                toInteger(product.display_order),
                product.archived_at || null,
                product.barcode
              ]
            );
          } else {
            database.run(
              `INSERT INTO products (barcode, name_en, name_ar, country, weight, unit_price_fils, product_by, pack_qty_text, stock_qty, reorder_level, display_order, archived_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                product.barcode,
                product.name_en || '',
                product.name_ar || '',
                product.country || '',
                product.weight || '',
                toInteger(product.unit_price_fils),
                product.product_by || '',
                packQtyText,
                stockQty,
                toInteger(product.reorder_level, 5),
                toInteger(product.display_order),
                product.archived_at || null
              ]
            );
          }
        }
      }

      if (Array.isArray(data.documents)) {
        for (const document of data.documents) {
          database.run(
            `INSERT OR REPLACE INTO documents (id, doc_type, doc_number, payload, status, total_fils, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              document.id,
              document.doc_type,
              document.doc_number,
              normalizeImportedPayload(document.payload, 'document'),
              document.status,
              toInteger(document.total_fils),
              document.created_at,
              document.updated_at
            ]
          );
        }
      }

      if (Array.isArray(data.templates)) {
        for (const template of data.templates) {
          database.run(
            `INSERT OR REPLACE INTO templates (id, name, doc_type, payload, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              template.id,
              template.name,
              template.doc_type || 'letterhead',
              normalizeImportedPayload(template.payload, 'template'),
              template.created_at,
              template.updated_at
            ]
          );
        }
      }

      if (Array.isArray(data.stock_movements)) {
        for (const movement of data.stock_movements) {
          database.run(
            `INSERT OR REPLACE INTO stock_movements (id, product_id, document_id, qty_change, reason, note, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              movement.id,
              movement.product_id,
              movement.document_id || null,
              toInteger(movement.qty_change),
              movement.reason || 'sale',
              movement.note || '',
              movement.created_at
            ]
          );
        }
      }

      if (Array.isArray(data.barcode_library)) {
        for (const entry of data.barcode_library) {
          database.run(
            `INSERT OR REPLACE INTO barcode_library
             (id, barcode_number, format, name_en, name_ar, weight, unit_price_fils, product_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              entry.id,
              entry.barcode_number,
              entry.format || 'code128',
              entry.name_en || '',
              entry.name_ar || '',
              entry.weight || '',
              toInteger(entry.unit_price_fils),
              entry.product_by || '',
              entry.created_at,
              entry.updated_at
            ]
          );
        }
      }

      database.exec('COMMIT');
      saveDBToDisk();
      return { success: true };
    } catch (error) {
      try {
        database.exec('ROLLBACK');
      } catch (_) {
        // Ignore rollback failures so the original import error is preserved.
      }
      throw error;
    }
  }

  ipcMain.handle('import-all-data', async (_event, data) => {
    try {
      return await importAllDataPayload(data);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  registerImportIpc
};
