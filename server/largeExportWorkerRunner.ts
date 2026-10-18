import { firebaseLargeExportWorker } from './largeExportWorker';

const worker=firebaseLargeExportWorker();let stopping=false;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
while(!stopping){const worked=await worker.expireNext()||await worker.runNext();if(!worked)await new Promise(resolve=>setTimeout(resolve,5000));}
