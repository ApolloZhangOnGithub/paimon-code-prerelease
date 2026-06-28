// who_is_spy/spy-tool.ts — spy 工具（零依赖，内联引擎）
export async function spyTool(args: any, _ctx: any, _personDir: string): Promise<{ content: any[]; details: any }> {
  const a = args.action || "";
  if (!a) return m("谁是卧底\n\n  spy new [人数]  — 开局\n  spy describe <描述>\n  spy vote <名字>\n  spy status / history");
  if (a === "new") return doNew(args);
  if (!G) return m("无游戏。spy new 开局");
  if (G.over) return m(G.view() + "\n\nspy new 再来");
  if (a === "status") return m(G.view());
  if (a === "history") return m(G.h.join("\n") || "暂无");
  if (a === "describe") { const t = (args.text||"").trim(); if(!t)return m("描述什么？"); const ok=G.desc("你",t); return m(ok?G.view():G.err); }
  if (a === "vote") { const t=args.target||""; if(!t)return m("投谁？"); const ok=G.vote("你",t); return m(ok?G.view():G.err); }
  return m("未知: "+a);
}
function m(s:string){return{content:[{type:"text",text:s}],details:{}}}

let G:any=null;
const W=[["苹果","梨"],["猫","狗"],["咖啡","茶"],["雨伞","遮阳伞"],["火车","地铁"],["沙发","椅子"],["钢琴","电子琴"],["汉堡","三明治"]];

function doNew(args:any){
  const n=Math.max(3,Math.min(7,+(args.players||5)||5));
  const p=W[Math.random()*W.length|0],si=Math.random()*n|0;
  const nm=["你","甲","乙","丙","丁","戊"].slice(0,n);
  const ps=nm.map((x,i)=>({n:x,w:i===si?p[0]:p[1],s:i===si,l:true}));
  let ph=0,r=1,ti=0,vr:Record<string,string>={},hs:string[]=[],er="",ds:{p:string;t:string}[]=[];
  const lv=()=>ps.filter((x:any)=>x.l).map((x:any)=>x.n);
  const tn=()=>lv()[ti%lv().length];
  function nx(){
    if(ph===0){ph=1;vr={}}
    else if(ph===1){
      const ta:Record<string,number>={};for(const t of Object.values(vr))ta[t]=(ta[t]||0)+1;
      const mx=Math.max(...Object.values(ta));
      const el=Object.entries(ta).filter(([,c])=>c===mx).map(([n])=>n);
      if(el.length===1){
        const x=ps.find((x:any)=>x.n===el[0])!;x.l=false;
        hs.push("淘汰: "+x.n+(x.s?" (卧底!)":""));
        const sc=ps.filter((x:any)=>x.l&&x.s).length,cc=ps.filter((x:any)=>x.l&&!x.s).length;
        if(sc===0){ph=2;hs.push("平民胜利!")}
        else if(sc>=cc){ph=2;hs.push("卧底胜利!")}
        else{ph=0;r++;ti=0;ds=[]}
      }else{hs.push("平票: "+el.join(","));ph=0;r++;ti=0;ds=[]}
    }
  }
  G={
    get over(){return ph===2},get err(){return er},h:hs,
    view(){
      if(ph===2){const x=ps.find((x:any)=>x.s)!;return "结束\n卧底: "+x.n+" (词: "+x.w+")\n"+hs.join("\n")}
      const lns=["第"+r+"轮 | "+(ph===0?"描述":"投票"),"你的词: "+ps[0].w];
      if(ph===0){lns.push("轮到: "+tn());if(ds.length)lns.push(...ds.map((d:any)=>"  "+d.p+": \""+d.t+"\""))}
      else{if(ds.length)lns.push(...ds.map((d:any)=>"  "+d.p+": \""+d.t+"\""));lns.push("已投: "+(Object.keys(vr).join(",")||"无"),"可选: "+lv().filter((n:string)=>n!=="你").join(","))}
      return lns.join("\n");
    },
    desc(nm:string,tx:string){if(ph!==0){er="非描述阶段";return false}if(nm!==tn()){er="没轮到("+tn()+")";return false}if(ds.find((d:any)=>d.p===nm)){er="已描述";return false}ds.push({p:nm,t:tx});hs.push("R"+r+" "+nm+": \""+tx+"\"");ti++;if(ds.length>=lv().length)nx();return true},
    vote(vt:string,tg:string){if(ph!==1){er="非投票";return false}if(vr[vt]){er="已投";return false}if(!lv().includes(tg)){er=tg+"不在可选";return false}vr[vt]=tg;hs.push(vt+"→"+tg);if(Object.keys(vr).length>=lv().length)nx();return true},
  };
  return m(G.view());
}
