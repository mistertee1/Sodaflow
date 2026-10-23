import type { Document } from './store';

const canonical=(value:unknown):string=>Array.isArray(value)
  ?`[${value.map(canonical).join(',')}]`
  :value&&typeof value==='object'
    ?`{${Object.entries(value).filter(([,entry])=>entry!==undefined).sort(([left],[right])=>left.localeCompare(right)).map(([key,entry])=>`${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`
    :JSON.stringify(value)??'null';

export async function largeImportStagingSha256(rows:Document[]){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(rows)));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export const sameLargeImportRecord=(current:Document,expected:Document)=>canonical(current)===canonical(expected);
