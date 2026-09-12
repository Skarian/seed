// Separate process so fault tests can kill/restart the actual durable job owner.
import {WorkerConnection} from '../../dist/server/worker.js';
import {Jobs} from '../../dist/server/jobs.js';
import {openDatabase} from '../../dist/server/db.js';
import {resolvePaths} from '../../dist/server/storage.js';
const [root,origin]=process.argv.slice(2),paths=resolvePaths(root),db=openDatabase(paths.data);
const jobs=new Jobs(db,paths,new WorkerConnection(paths,origin));jobs.start();
process.send?.('ready');
process.once('SIGTERM',async()=>{await jobs.close();db.close();process.exit(0);});
