// Format Factory — media converter (M4A/MP4→WAV 16kHz mono)
import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
type F = (t:string,i?:number)=>string;

export function xInitState(ws:string){return{file:"",status:"drop file to convert",out:""}}
export function xRender(st:any,W:number,frow:F,sep:()=>string,bot:()=>string):string{
  let s="";
  if(st.file){s+=frow(`${st.file}`,1)+"\n";s+=sep()+"\n";s+=frow(st.status,1)+"\n"}
  else s+=frow("Format Factory — WAV Converter",1)+"\n"+sep()+"\n"+frow("open media file from Finder",1)+"\n";
  if(st.out)s+=sep()+"\n"+frow(st.out,1)+"\n";
  s+=bot();return s
}
export function xClick(st:any,id:string):any{return st}
export function xPress(st:any,k:string):any{return st}
export function xType(st:any,t:string):any{return st}

export function xOpenCreate(fp:string,ws:string):{type:string;state:any;min:boolean;full:boolean}|null{
  const ext=path.extname(fp).toLowerCase();
  const media=[".m4a",".mp4",".mov",".mkv",".webm",".avi",".mp3",".flv",".wmv",".m4v",".ogg",".wma",".aac",".flac"];
  if(!media.includes(ext))return null;
  const out="/tmp/"+path.basename(fp,ext)+"_16k.wav";
  let status="converting...";
  try{
    execSync(`ffmpeg -y -v quiet -i "${fp}" -ac 1 -ar 16000 -sample_fmt s16 -f wav "${out}"`,{timeout:120,stdio:"pipe"});
    const sz=statSync(out).size;status=`done: ${out} (${(sz/1e6).toFixed(1)}MB)`;
  }catch(e:any){status=`failed: ${e.message}`}
  return{type:"FFactory",state:{...xInitState(ws),file:fp,status,out},min:false,full:false}
}
