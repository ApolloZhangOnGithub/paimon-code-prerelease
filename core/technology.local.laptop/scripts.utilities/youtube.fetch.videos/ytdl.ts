// ytdl — YouTube audio downloader
import { execSync } from "node:child_process";
import path from "node:path";
type F = (t:string,i?:number)=>string;

export function xInitState(ws:string){return{url:"",status:"enter YouTube URL",out:""}}
export function xRender(st:any,W:number,frow:F,sep:()=>string,bot:()=>string):string{
  let s=frow("YouTube DL — Audio Downloader",1)+"\n"+sep()+"\n";
  if(st.url)s+=frow(`URL: ${st.url}`,1)+"\n";
  s+=frow(st.status,1)+"\n";
  if(st.out)s+=sep()+"\n"+frow(st.out,1)+"\n";
  s+=bot();return s
}
export function xClick(st:any,id:string):any{return st}
export function xPress(st:any,k:string):any{return st}
export function xType(st:any,t:string):any{
  if(!st.url){st.url=t;st.status="press Enter to download";return st}
  if(t.toLowerCase()==="enter"||t==="\n"){return xDownload(st)}
  return st
}
function xDownload(st:any):any{
  st.status="downloading...";
  try{
    const out="/tmp/yt_"+Date.now().toString(36)+".%(ext)s";
    const r=execSync(`yt-dlp --no-update -f "worstaudio[ext=m4a]" -o "${out}" "${st.url}"`,{timeout:120,encoding:"utf8",maxBuffer:100000});
    st.status="done";st.out=r.split("\n").slice(-3).join("\n")
  }catch(e:any){st.status="failed: "+e.message}
  return st
}
