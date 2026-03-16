function toInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function coalesceDefined(...values) {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
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

function resolvePackQtyText(packQtyText, stockQty, options = {}) {
  const source = typeof packQtyText === 'string' ? packQtyText : '';
  if (packQtyText !== undefined) {
    if (source.trim() !== '' || !options.preferStockWhenPackEmpty) {
      return source;
    }
  }

  if (stockQty !== undefined && stockQty !== null) {
    return setPackQtyValue(options.fallbackPackQtyText || source, stockQty);
  }

  return source;
}

function deriveStockQty(packQtyText) {
  const parsed = parsePackQtyValue(packQtyText);
  return Math.max(0, parsed == null ? 0 : parsed);
}

function normalizeProductRecord(product, options = {}) {
  if (!product || typeof product !== 'object') {
    return product || null;
  }

  const packQtyText = resolvePackQtyText(product.pack_qty_text, product.stock_qty, options);
  return {
    ...product,
    pack_qty_text: packQtyText,
    stock_qty: deriveStockQty(packQtyText)
  };
}

function orderExpression() {
  return "CASE WHEN display_order > 0 THEN display_order ELSE id END ASC, id ASC";
}

function resultToObjectArray(resultToObjects, database, sql, params = []) {
  return resultToObjects(database.exec(sql, params));
}

function resultToSingleObject(resultToObject, database, sql, params = []) {
  return resultToObject(database.exec(sql, params));
}

function normalizeProductInput(product = {}) {
  return {
    barcode: String(product.barcode || '').trim(),
    name_en: hasOwn(product, 'name_en') ? (product.name_en || '') : undefined,
    name_ar: hasOwn(product, 'name_ar') ? (product.name_ar || '') : undefined,
    country: hasOwn(product, 'country') ? (product.country || '') : undefined,
    weight: hasOwn(product, 'weight') ? (product.weight || '') : undefined,
    unit_price_fils: hasOwn(product, 'unit_price_fils')
      ? toInteger(product.unit_price_fils)
      : (hasOwn(product, 'unitPriceFils') ? toInteger(product.unitPriceFils) : undefined),
    product_by: hasOwn(product, 'product_by')
      ? (product.product_by || '')
      : (hasOwn(product, 'productBy') ? (product.productBy || '') : undefined),
    pack_qty_text: hasOwn(product, 'pack_qty_text') ? (product.pack_qty_text || '') : undefined,
    stock_qty: hasOwn(product, 'stock_qty') ? toInteger(product.stock_qty) : undefined,
    reorder_level: hasOwn(product, 'reorder_level') ? toInteger(product.reorder_level, 5) : undefined,
    display_order: hasOwn(product, 'display_order') ? Math.max(0, toInteger(product.display_order)) : undefined,
    archived_at: hasOwn(product, 'archived_at') ? (product.archived_at || null) : undefined
  };
}

function normalizeDocumentInput(document = {}) {
  return {
    id: document.id,
    doc_type: document.doc_type || 'invoice',
    doc_number: document.doc_number || '',
    payload: JSON.stringify(document.payload || {}),
    status: document.status || 'draft',
    total_fils: toInteger(document.total_fils)
  };
}

function normalizeBarcodeEntry(entry = {}) {
  return {
    barcode_number: entry.barcode_number || entry.barcodeNumber || '',
    format: entry.format || 'code128',
    name_en: entry.name_en || entry.itemNameEN || '',
    name_ar: entry.name_ar || entry.itemNameAR || '',
    weight: entry.weight || '',
    unit_price_fils: toInteger(entry.unit_price_fils || entry.unitPriceFils),
    product_by: entry.product_by || entry.productBy || ''
  };
}

async function runStoreAction(action, payload, deps) {
  const {
    getDB,
    resultToObject,
    resultToObjects,
    saveDBToDisk
  } = deps;
  const database = await getDB();

  switch (action) {
    case 'products.list':
      return resultToObjectArray(
        resultToObjects,
        database,
        `SELECT * FROM products WHERE archived_at IS NULL ORDER BY ${orderExpression()}`
      ).map((product) => normalizeProductRecord(product));

    case 'products.listAll':
      return resultToObjectArray(
        resultToObjects,
        database,
        `SELECT * FROM products ORDER BY ${orderExpression()}`
      ).map((product) => normalizeProductRecord(product));

    case 'products.getByBarcode':
      return normalizeProductRecord(resultToSingleObject(
        resultToObject,
        database,
        'SELECT * FROM products WHERE barcode = ? AND archived_at IS NULL',
        [payload.barcode]
      ));

    case 'products.search': {
      const q = `%${String(payload.query || '').trim()}%`;
      return resultToObjectArray(
        resultToObjects,
        database,
        `SELECT * FROM products
         WHERE archived_at IS NULL AND (barcode LIKE ? OR name_en LIKE ? OR name_ar LIKE ? OR pack_qty_text LIKE ?)
         ORDER BY ${orderExpression()}`,
        [q, q, q, q]
      ).map((product) => normalizeProductRecord(product));
    }

    case 'products.upsert': {
      const incoming = normalizeProductInput(payload.product);
      if (!incoming.barcode) {
        throw new Error('Product barcode is required.');
      }

      const existing = resultToSingleObject(resultToObject, database, 'SELECT * FROM products WHERE barcode = ?', [incoming.barcode]);
      const existingProduct = normalizeProductRecord(existing);
      const nextDisplayOrder = () => {
        const row = resultToSingleObject(
          resultToObject,
          database,
          'SELECT COALESCE(MAX(CASE WHEN display_order > 0 THEN display_order ELSE id END), 0) + 1 AS next_display_order FROM products'
        );
        return Math.max(1, toInteger(row?.next_display_order, 1));
      };

      const packQtyText = resolvePackQtyText(
        incoming.pack_qty_text,
        incoming.stock_qty,
        { fallbackPackQtyText: existingProduct?.pack_qty_text || '' }
      );

      const product = existing
        ? {
          barcode: incoming.barcode,
          name_en: coalesceDefined(incoming.name_en, existingProduct.name_en, ''),
          name_ar: coalesceDefined(incoming.name_ar, existingProduct.name_ar, ''),
          country: coalesceDefined(incoming.country, existingProduct.country, ''),
          weight: coalesceDefined(incoming.weight, existingProduct.weight, ''),
          unit_price_fils: coalesceDefined(incoming.unit_price_fils, existingProduct.unit_price_fils, 0),
          product_by: coalesceDefined(incoming.product_by, existingProduct.product_by, ''),
          pack_qty_text: packQtyText,
          stock_qty: deriveStockQty(packQtyText),
          reorder_level: coalesceDefined(incoming.reorder_level, existingProduct.reorder_level, 5),
          display_order: (incoming.display_order && incoming.display_order > 0)
            ? incoming.display_order
            : ((Number(existingProduct.display_order) > 0) ? Number(existingProduct.display_order) : nextDisplayOrder())
        }
        : {
          barcode: incoming.barcode,
          name_en: coalesceDefined(incoming.name_en, ''),
          name_ar: coalesceDefined(incoming.name_ar, ''),
          country: coalesceDefined(incoming.country, ''),
          weight: coalesceDefined(incoming.weight, ''),
          unit_price_fils: coalesceDefined(incoming.unit_price_fils, 0),
          product_by: coalesceDefined(incoming.product_by, ''),
          pack_qty_text: packQtyText,
          stock_qty: deriveStockQty(packQtyText),
          reorder_level: coalesceDefined(incoming.reorder_level, 5),
          display_order: (incoming.display_order && incoming.display_order > 0)
            ? incoming.display_order
            : nextDisplayOrder()
        };

      if (existing) {
        database.run(
          `UPDATE products SET name_en=?, name_ar=?, country=?, weight=?, unit_price_fils=?,
           product_by=?, pack_qty_text=?, stock_qty=?, reorder_level=?, display_order=?, archived_at=NULL, updated_at=datetime('now') WHERE barcode=?`,
          [
            product.name_en,
            product.name_ar,
            product.country,
            product.weight,
            product.unit_price_fils,
            product.product_by,
            product.pack_qty_text,
            product.stock_qty,
            product.reorder_level,
            product.display_order,
            product.barcode
          ]
        );
        saveDBToDisk();
        return normalizeProductRecord({ ...existingProduct, ...product, archived_at: null, id: existing.id });
      }

      database.run(
        `INSERT INTO products (barcode, name_en, name_ar, country, weight, unit_price_fils, product_by, pack_qty_text, stock_qty, reorder_level, display_order, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          product.barcode,
          product.name_en,
          product.name_ar,
          product.country,
          product.weight,
          product.unit_price_fils,
          product.product_by,
          product.pack_qty_text,
          product.stock_qty,
          product.reorder_level,
          product.display_order
        ]
      );
      const created = resultToSingleObject(resultToObject, database, 'SELECT last_insert_rowid() AS id');
      saveDBToDisk();
      return normalizeProductRecord({ ...product, archived_at: null, id: created ? created.id : 0 });
    }

    case 'products.delete':
      database.run(
        "UPDATE products SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        [payload.id]
      );
      saveDBToDisk();
      return { success: true };

    case 'products.destroy':
      database.run('DELETE FROM stock_movements WHERE product_id = ?', [payload.id]);
      database.run('DELETE FROM products WHERE id = ?', [payload.id]);
      saveDBToDisk();
      return { success: true };

    case 'products.restore':
      database.run(
        "UPDATE products SET archived_at = NULL, updated_at = datetime('now') WHERE id = ?",
        [payload.id]
      );
      saveDBToDisk();
      return { success: true };

    case 'products.updateQty':
      {
        const existingProductForQty = normalizeProductRecord(resultToSingleObject(
          resultToObject,
          database,
          'SELECT * FROM products WHERE barcode = ? AND archived_at IS NULL',
          [payload.barcode]
        ));
        if (!existingProductForQty) {
          return { success: true };
        }

        const nextPackQtyText = setPackQtyValue(
          existingProductForQty.pack_qty_text,
          deriveStockQty(existingProductForQty.pack_qty_text) + toInteger(payload.qtyChange)
        );
        database.run(
          "UPDATE products SET pack_qty_text = ?, stock_qty = ?, updated_at = datetime('now') WHERE barcode = ? AND archived_at IS NULL",
          [nextPackQtyText, deriveStockQty(nextPackQtyText), payload.barcode]
        );
      }
      saveDBToDisk();
      return { success: true };

    case 'documents.save': {
      const document = normalizeDocumentInput(payload.document);
      if (document.id) {
        database.run(
          `UPDATE documents SET doc_type=?, doc_number=?, payload=?, status=?, total_fils=?, updated_at=datetime('now') WHERE id=?`,
          [document.doc_type, document.doc_number, document.payload, document.status, document.total_fils, document.id]
        );
        saveDBToDisk();
        return payload.document;
      }

      database.run(
        'INSERT INTO documents (doc_type, doc_number, payload, status, total_fils) VALUES (?, ?, ?, ?, ?)',
        [document.doc_type, document.doc_number, document.payload, document.status, document.total_fils]
      );
      const created = resultToSingleObject(resultToObject, database, 'SELECT last_insert_rowid() AS id');
      saveDBToDisk();
      return { ...(payload.document || {}), id: created ? created.id : 0 };
    }

    case 'documents.get':
      return resultToSingleObject(resultToObject, database, 'SELECT * FROM documents WHERE id = ?', [payload.id]);

    case 'documents.listHistory': {
      let sql = 'SELECT id, doc_type, doc_number, payload, total_fils, status, created_at, updated_at FROM documents WHERE doc_type = ?';
      const params = [payload.docType];
      if (payload.query) {
        sql += ' AND (doc_number LIKE ? OR payload LIKE ?)';
        const q = `%${String(payload.query).trim()}%`;
        params.push(q, q);
      }
      sql += ' ORDER BY updated_at DESC LIMIT 100';
      return resultToObjectArray(resultToObjects, database, sql, params);
    }

    case 'documents.listAll':
      return resultToObjectArray(resultToObjects, database, 'SELECT * FROM documents ORDER BY created_at DESC');

    case 'documents.delete':
      database.run('DELETE FROM documents WHERE id = ?', [payload.id]);
      saveDBToDisk();
      return { success: true };

    case 'stockMovements.add':
      database.run(
        'INSERT INTO stock_movements (product_id, document_id, qty_change, reason, note) VALUES (?, ?, ?, ?, ?)',
        [payload.productId, payload.docId, toInteger(payload.qtyChange), payload.reason || 'sale', payload.note || '']
      );
      saveDBToDisk();
      return { success: true };

    case 'stockMovements.listByProduct':
      return resultToObjectArray(
        resultToObjects,
        database,
        `SELECT sm.*, d.doc_number, d.doc_type
         FROM stock_movements sm
         LEFT JOIN documents d ON d.id = sm.document_id
         WHERE sm.product_id = ?
         ORDER BY sm.created_at DESC, sm.id DESC`,
        [payload.productId]
      );

    case 'stockMovements.listAll':
      return resultToObjectArray(resultToObjects, database, 'SELECT * FROM stock_movements ORDER BY created_at DESC');

    case 'barcodeLibrary.save': {
      const entry = normalizeBarcodeEntry(payload.entry);
      const existing = resultToSingleObject(
        resultToObject,
        database,
        'SELECT id FROM barcode_library WHERE barcode_number = ?',
        [entry.barcode_number]
      );

      if (existing) {
        database.run(
          `UPDATE barcode_library
           SET format = ?, name_en = ?, name_ar = ?, weight = ?, unit_price_fils = ?, product_by = ?, updated_at = datetime('now')
           WHERE id = ?`,
          [
            entry.format,
            entry.name_en,
            entry.name_ar,
            entry.weight,
            entry.unit_price_fils,
            entry.product_by,
            existing.id
          ]
        );
        saveDBToDisk();
        return { id: existing.id, ...entry };
      }

      database.run(
        `INSERT INTO barcode_library (barcode_number, format, name_en, name_ar, weight, unit_price_fils, product_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.barcode_number,
          entry.format,
          entry.name_en,
          entry.name_ar,
          entry.weight,
          entry.unit_price_fils,
          entry.product_by
        ]
      );
      const created = resultToSingleObject(resultToObject, database, 'SELECT last_insert_rowid() AS id');
      saveDBToDisk();
      return { id: created ? created.id : 0, ...entry };
    }

    case 'barcodeLibrary.list': {
      let sql = 'SELECT * FROM barcode_library';
      const params = [];
      if (payload.query) {
        const q = `%${String(payload.query).trim()}%`;
        sql += ' WHERE barcode_number LIKE ? OR name_en LIKE ? OR name_ar LIKE ? OR product_by LIKE ?';
        params.push(q, q, q, q);
      }
      sql += ' ORDER BY updated_at DESC, id DESC';
      return resultToObjectArray(resultToObjects, database, sql, params);
    }

    case 'barcodeLibrary.delete':
      database.run('DELETE FROM barcode_library WHERE id = ?', [payload.id]);
      saveDBToDisk();
      return { success: true };

    case 'settings.get': {
      const setting = resultToSingleObject(resultToObject, database, 'SELECT value FROM settings WHERE key = ?', [payload.key]);
      return setting ? setting.value : null;
    }

    case 'settings.set':
      database.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [payload.key, String(payload.value)]);
      saveDBToDisk();
      return { success: true };

    case 'settings.list':
      return resultToObjectArray(resultToObjects, database, 'SELECT * FROM settings');

    case 'templates.save': {
      const name = String(payload.name || '').trim();
      const docType = payload.docType || 'letterhead';
      const existing = resultToSingleObject(
        resultToObject,
        database,
        'SELECT id FROM templates WHERE name = ? AND doc_type = ?',
        [name, docType]
      );

      if (existing) {
        database.run(
          "UPDATE templates SET payload = ?, updated_at = datetime('now') WHERE name = ? AND doc_type = ?",
          [JSON.stringify(payload.payload || {}), name, docType]
        );
        saveDBToDisk();
        return { success: true };
      }

      database.run(
        'INSERT INTO templates (name, doc_type, payload) VALUES (?, ?, ?)',
        [name, docType, JSON.stringify(payload.payload || {})]
      );
      saveDBToDisk();
      return { success: true };
    }

    case 'templates.list': {
      let sql = 'SELECT * FROM templates';
      const params = [];
      if (payload.docType) {
        sql += ' WHERE doc_type = ?';
        params.push(payload.docType);
      }
      sql += ' ORDER BY updated_at DESC';
      return resultToObjectArray(resultToObjects, database, sql, params);
    }

    case 'templates.delete':
      database.run('DELETE FROM templates WHERE name = ? AND doc_type = ?', [payload.name, payload.docType || 'letterhead']);
      saveDBToDisk();
      return { success: true };

    default:
      throw new Error(`Unknown store action: ${action}`);
  }
}

function registerStoreIpc({ ipcMain, getDB, resultToObject, resultToObjects, saveDBToDisk }) {
  ipcMain.handle('store-invoke', async (_event, action, payload = {}) => {
    try {
      const data = await runStoreAction(action, payload || {}, {
        getDB,
        resultToObject,
        resultToObjects,
        saveDBToDisk
      });
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error.message || 'Store action failed.' };
    }
  });
}

module.exports = {
  registerStoreIpc
};
