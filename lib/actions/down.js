const _ = require("lodash");
const { promisify } = require("util");
const fnArgs = require('fn-args');

const status = require("./status");
const config = require("../env/config");
const migrationsDir = require("../env/migrationsDir");
const hasCallback = require('../utils/has-callback');

module.exports = async (db, client) => {
  const downgraded = [];
  const { saveFileContents, changelogCollectionName } = await config.read();
  const changelogCollection = db.collection(changelogCollectionName);
  const statusItems = await status(db, saveFileContents);
  const appliedItems = statusItems.filter(item => item.appliedAt !== "PENDING");
  const lastAppliedItem = _.last(appliedItems);

  if (lastAppliedItem) {
    try {
      if (saveFileContents) {
        const savedItem = await changelogCollection.findOne({ fileName: lastAppliedItem.fileName });
        if (savedItem.fileContents !== undefined) {
          await migrationsDir.writeFileContents(lastAppliedItem.fileName, savedItem.fileContents);
        }
      }
      const migration = await migrationsDir.loadMigration(lastAppliedItem.fileName);
      const down = hasCallback(migration.down) ? promisify(migration.down) : migration.down;

      if (hasCallback(migration.down) && fnArgs(migration.down).length < 3) {
        // support old callback-based migrations prior to migrate-mongo 7.x.x
        await down(db);
      } else {
        await down(db, client);
      }

    } catch (err) {
      throw new Error(
        `Could not migrate down ${lastAppliedItem.fileName}: ${err.message}`
      );
    }
    try {
      await changelogCollection.deleteOne({ fileName: lastAppliedItem.fileName });
      downgraded.push(lastAppliedItem.fileName);
    } catch (err) {
      throw new Error(`Could not update changelog: ${err.message}`);
    }
  }

  return downgraded;
};
