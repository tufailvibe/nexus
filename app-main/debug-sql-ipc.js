function registerRawSqlIpc({
  ipcMain,
  getDB,
  assertAllowedSql,
  resultToObject,
  resultToObjects,
  saveDBToDisk
}) {
  ipcMain.handle('db-run', async (_event, sql, params) => {
    try {
      const database = await getDB();
      const statement = assertAllowedSql(sql, ['INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'BEGIN', 'COMMIT', 'ROLLBACK']);
      database.run(statement, params || []);
      const lastId = database.exec('SELECT last_insert_rowid()');
      const changes = database.getRowsModified();
      saveDBToDisk();
      return {
        success: true,
        changes,
        lastInsertRowid: lastId.length > 0 ? lastId[0].values[0][0] : 0
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get', async (_event, sql, params) => {
    try {
      const database = await getDB();
      const statement = assertAllowedSql(sql, ['SELECT', 'PRAGMA', 'WITH']);
      const result = database.exec(statement, params || []);
      return { success: true, data: resultToObject(result) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-all', async (_event, sql, params) => {
    try {
      const database = await getDB();
      const statement = assertAllowedSql(sql, ['SELECT', 'PRAGMA', 'WITH']);
      const result = database.exec(statement, params || []);
      return { success: true, data: resultToObjects(result) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  registerRawSqlIpc
};
