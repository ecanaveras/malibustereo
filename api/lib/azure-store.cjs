const { TableClient, odata } = require('@azure/data-tables');

function createStore(connectionString, tableName = 'MalibuPresence', client) {
  const table = client || TableClient.fromConnectionString(connectionString, tableName);
  let ready;
  let nextCleanup = 0;
  const init = () => ready ||= table.createTable().catch(error => { ready = null; throw error; });
  return {
    async touch(id, now) {
      await init();
      await table.upsertEntity({ partitionKey: 'presence', rowKey: id, lastSeen: new Date(now).toISOString() }, 'Merge');
      if (now >= nextCleanup) {
        nextCleanup = now + 60_000;
        // No messages or names are stored. Delete up to 20 stale metadata rows per minute.
        const cutoff = new Date(now - 86_400_000).toISOString();
        const stale = table.listEntities({ queryOptions: { filter: odata`lastSeen lt ${cutoff}` } });
        let removed = 0;
        for await (const row of stale) {
          try { await table.deleteEntity(row.partitionKey, row.rowKey, { etag: row.etag }); }
          catch (error) { if (![404, 412].includes(error.statusCode)) throw error; }
          if (++removed >= 20) break;
        }
      }
    },
    async count(since) {
      await init();
      const cutoff = new Date(since).toISOString();
      let count = 0;
      for await (const row of table.listEntities({ queryOptions: {
        filter: odata`PartitionKey eq 'presence' and lastSeen ge ${cutoff}`, select: ['RowKey']
      } })) count++;
      return count;
    },
    async claimSend(id, now) {
      await init();
      const entity = { partitionKey: 'throttle', rowKey: id, lastSeen: new Date(now).toISOString() };
      try {
        const previous = await table.getEntity('throttle', id);
        if (now - Date.parse(previous.lastSeen) < 3000) return false;
        await table.updateEntity(entity, 'Replace', { etag: previous.etag });
        return true;
      } catch (error) {
        if (error.statusCode === 412) return false;
        if (error.statusCode !== 404) throw error;
        try { await table.createEntity(entity); return true; }
        catch (insertError) { if (insertError.statusCode === 409) return false; throw insertError; }
      }
    }
  };
}
module.exports = { createStore };
