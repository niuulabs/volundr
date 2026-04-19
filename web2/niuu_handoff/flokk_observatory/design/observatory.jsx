/* global React */
// ─── Flokk Observatory canvas — ice-themed adaptation of RavnFlockView ───

const { useCallback, useEffect, useMemo, useRef, useState } = React;

// Ice-themed palette, matched to Niuu DS [data-theme='ice'] brand ramp
const C = {
  ice:     { r:186, g:230, b:253 },  // bright (brand-300)
  frost:   { r:125, g:211, b:252 },  // active / raid (brand-500 local override)
  moon:    { r:224, g:242, b:254 },  // elder ravens, Mímir (brand-200)
  indigo:  { r:147, g:197, b:253 },  // skuld, bifrost threads
  slate:   { r:148, g:163, b:184 },  // muted labels
  dim:     { r:100, g:115, b:140 },  // infra chrome
  model:   { r:140, g:170, b:210 },
  valk:    { r:170, g:205, b:245 },
  device:  { r:130, g:155, b:185 },
  crit:    { r:239, g:68,  b:68  },
};
const rgba = (c, a) => `rgba(${c.r},${c.g},${c.b},${a})`;

const KIND_R = { ravn_long:9, ravn_raid:6, skuld:7, tyr:11, bifrost:10, mimir:42, volundr:13, model:6, valkyrie:10, printer:8, vaettir:7, beacon:4, service:3, host:8, mimir_sub:18 };

// ── Seed data (stripped from RavnFlockView, but typed as Entities) ──
const WORLD_W = 4200, WORLD_H = 3600;
const REALMS = [
  { id:'yggdrasil',    label:'Yggdrasil',    vlan:0,   purpose:'core admin',         dns:'yggdrasil.niuu.world',    wx:200,  wy:200,  wr:180 },
  { id:'asgard',       label:'Asgard',       vlan:90,  purpose:'AI / compute / dev', dns:'asgard.niuu.world',       wx:2000, wy:1300, wr:720 },
  { id:'vanaheim',     label:'Vanaheim',     vlan:80,  purpose:'infrastructure',     dns:'vanaheim.niuu.world',     wx:500,  wy:700,  wr:300 },
  { id:'svartalfheim', label:'Svartalfheim', vlan:40,  purpose:'workshop / printers',dns:'svartalfheim.niuu.world', wx:3600, wy:2200, wr:380 },
  { id:'midgard',      label:'Midgard',      vlan:60,  purpose:'home / general',     dns:'midgard.niuu.world',      wx:1100, wy:2800, wr:320 },
  { id:'alfheim',      label:'Alfheim',      vlan:70,  purpose:'monitoring',         dns:'alfheim.niuu.world',      wx:500,  wy:2200, wr:250 },
  { id:'niflheim',     label:'Niflheim',     vlan:20,  purpose:'IoT / ESP32',        dns:'niflheim.niuu.world',     wx:2800, wy:3000, wr:240 },
  { id:'muspelheim',   label:'Muspelheim',   vlan:30,  purpose:'work / productivity',dns:'muspelheim.niuu.world',   wx:3600, wy:700,  wr:220 },
  { id:'jotunheim',    label:'Jötunheim',    vlan:50,  purpose:'IPMI / BMC',         dns:'jotunheim.niuu.world',    wx:3600, wy:1350, wr:200 },
  { id:'helheim',      label:'Helheim',      vlan:10,  purpose:'cameras / NVR',      dns:'helheim.niuu.world',      wx:150,  wy:1400, wr:180 },
  { id:'bifrost-realm',label:'Bifröst',      vlan:100, purpose:'remote / cloud',     dns:'bifrost.niuu.world',      wx:2000, wy:3200, wr:200 },
];
const CLUSTERS = [
  { id:'valaskjalf', label:'Valaskjálf', realm:'asgard',       purpose:'DGX Spark',     wx:2000, wy:1550, wr:280 },
  { id:'valhalla',   label:'Valhalla',   realm:'asgard',       purpose:'AI/ML',         wx:2360, wy:1020, wr:170 },
  { id:'noatun',     label:'Nóatún',     realm:'asgard',       purpose:'CI/CD',         wx:1640, wy:1020, wr:140 },
  { id:'eitri',      label:'Eitri',      realm:'svartalfheim', purpose:'workshop k8s',  wx:3600, wy:2180, wr:220 },
  { id:'glitnir',    label:'Glitnir',    realm:'alfheim',      purpose:'observability', wx:500,  wy:2200, wr:170 },
  { id:'jarnvidr',   label:'Járnviðr',   realm:'midgard',      purpose:'media',         wx:1100, wy:2800, wr:170 },
];

const SUB_MIMIRS = [
  { id:'mimir-code', name:'Mimir/Code', purpose:'codebase' },
  { id:'mimir-ops',  name:'Mimir/Ops',  purpose:'infra runbooks' },
  { id:'mimir-lore', name:'Mimir/Lore', purpose:'project history' },
];

function seedEntities() {
  const out = [];
  // Hosts
  [
    ['tanngrisnir','Tanngrisnir','asgard','DGX Spark','Ubuntu 24',144,'1 TiB','GH200'],
    ['tanngnjostr','Tanngnjostr','asgard','DGX Spark','Ubuntu 24',144,'1 TiB','GH200'],
    ['heidrun',    'Heidrun',    'asgard','DGX Spark','Ubuntu 24',144,'1 TiB','GH200'],
    ['thrudr',     'Thrudr',     'asgard','Mac mini M4','macOS',10,'24 GB',null],
    ['saga',       'Saga',       'vanaheim','TrueNAS','TrueNAS Scale',null,null,null],
    ['skrymir',    'Skrymir',    'asgard','EPYC 7532','Ubuntu 24',32,'512 GB',null],
    ['macbook',    'MacBook Pro','midgard','MacBook Pro M3','macOS',null,null,null],
    ['framework',  'Framework',  'midgard','Framework 16','Linux',null,null,null],
    ['austri',     'Austri',     'svartalfheim','RPi 5','RKE2 agent',null,null,null],
    ['nordri',     'Nordri',     'svartalfheim','RPi 5','RKE2 agent',null,null,null],
  ].forEach(([id,name,zone,hw,os,cores,ram,gpu]) => {
    out.push({ id:`host-${id}`, name, kind:'host', zone, cluster:null, flockId:null, activity:'idle', tokens:0, hw, os, cores, ram, gpu, wr: hw==='DGX Spark'?80:hw==='Mac mini M4'?55:hw==='EPYC 7532'?75:hw==='TrueNAS'?70:hw?.startsWith('RPi')?45:50 });
  });

  // Services
  [
    ['sleipnir','Sleipnir','asgard','valaskjalf','rabbitmq'],
    ['keycloak','Keycloak','asgard','valaskjalf','auth'],
    ['openbao','OpenBao','asgard','valaskjalf','secrets'],
    ['cerbos','Cerbos','asgard','valaskjalf','authz'],
    ['pg-main','PostgreSQL','asgard','valaskjalf','database'],
    ['vllm','vLLM','asgard','valhalla','inference'],
    ['ollama','Ollama','asgard','valhalla','inference'],
    ['harbor','Harbor','asgard','noatun','registry'],
    ['fleet','Fleet','asgard','noatun','gitops'],
    ['nalir','Nalir','svartalfheim','eitri','manufacturing'],
    ['omni-farm','Omni Farm','svartalfheim','eitri','orchestrator'],
    ['grafana','Grafana','alfheim','glitnir','dashboard'],
    ['loki','Loki','alfheim','glitnir','logs'],
    ['tempo','Tempo','alfheim','glitnir','traces'],
    ['plex','Plex','midgard','jarnvidr','media'],
    ['radarr','Radarr','midgard','jarnvidr','media'],
  ].forEach(([id,name,zone,cluster,svcType]) => {
    out.push({ id:`svc-${id}`, name, kind:'service', zone, cluster, flockId:null, activity:'idle', tokens:0, svcType });
  });

  // Printers
  ['Hrotti','Gungnir','Draupnir','Mjölnir','Tyrfing','Gram'].forEach(n => {
    out.push({ id:`printer-${n.toLowerCase()}`, name:n, kind:'printer', zone:'svartalfheim', cluster:null, flockId:null, activity:n==='Gungnir'||n==='Mjölnir'?'tooling':'idle', tokens:0, model:'Saturn 4 Ultra' });
  });

  // Vættir / beacons
  [
    ['vaettir-office',  'Chatterbox/Office',  'midgard','vaettir'],
    ['vaettir-living',  'Chatterbox/Living',  'midgard','vaettir'],
    ['vaettir-workshop','Chatterbox/Workshop','niflheim','vaettir'],
    ['beacon-office',   'ESPresense/Office',  'niflheim','beacon'],
    ['beacon-living',   'ESPresense/Living',  'niflheim','beacon'],
    ['beacon-workshop', 'ESPresense/Workshop','niflheim','beacon'],
  ].forEach(([id,name,zone,kind]) => {
    out.push({ id, name, kind, zone, cluster:null, flockId:null, activity:'idle', tokens:0, sensors: kind==='vaettir'?['mmwave','mic','speaker']:[] });
  });

  // Týrs
  out.push({ id:'tyr-1',name:'Tyr',kind:'tyr',zone:'asgard',cluster:'valaskjalf',flockId:null,activity:'idle',tokens:0, activeSagas:3, pendingRaids:2, mode:'active' });
  out.push({ id:'tyr-2',name:'Tyr/Prod',kind:'tyr',zone:'vanaheim',cluster:null,flockId:null,activity:'idle',tokens:0, activeSagas:1, pendingRaids:0, mode:'standby' });
  // Bifrösts
  out.push({ id:'bifrost-1',name:'Bifrost',kind:'bifrost',zone:'asgard',cluster:'valaskjalf',flockId:null,activity:'idle',tokens:0, providers:['Anthropic','OpenAI','Google','Local'], reqPerMin:42, cacheHitRate:0.68 });
  out.push({ id:'bifrost-2',name:'Bifrost/Edge',kind:'bifrost',zone:'vanaheim',cluster:null,flockId:null,activity:'idle',tokens:0, providers:['Local'], reqPerMin:8, cacheHitRate:0.45 });
  // Völundrs
  out.push({ id:'volundr-1',name:'Volundr',kind:'volundr',zone:'asgard',cluster:'valaskjalf',flockId:null,activity:'idle',tokens:0, activeSessions:5, maxSessions:20 });
  out.push({ id:'volundr-2',name:'Volundr/Eitri',kind:'volundr',zone:'svartalfheim',cluster:'eitri',flockId:null,activity:'idle',tokens:0, activeSessions:2, maxSessions:8 });
  // Mímir
  out.push({ id:'mimir',name:'Mimir',kind:'mimir',zone:'asgard',cluster:'valaskjalf',flockId:null,activity:'idle',tokens:0 });
  // long ravens
  [
    ['Huginn','thought','architecture & design','ᚹ','host-tanngrisnir'],
    ['Muninn','memory','history & context','ᛗ','host-tanngnjostr'],
    ['Thrymr','strength','infrastructure & ops','ᛞ','host-heidrun'],
    ['Gunnr','battle','testing & QA','ᛒ',null],
    ['Hlokk','noise','monitoring & alerts','ᛚ',null],
    ['Skogul','valkyrie','deployment & release','ᚲ',null],
  ].forEach((lp,i) => {
    out.push({ id:`long-${i}`, name:lp[0], kind:'ravn_long', zone:'asgard', hostId:lp[4], flockId:lp[4]?null:'long', activity:'idle',
      tokens: 18000 + Math.floor(Math.random()*60000), persona:lp[1], specialty:lp[2], rune:lp[3] });
  });
  [['Vidofnir','mimir-code','code navigation'],['Nidhogg','mimir-code','refactoring'],['Rata','mimir-ops','runbook authoring'],['Dain','mimir-lore','project history']].forEach((s,i)=>{
    out.push({ id:`spec-${i}`, name:s[0], kind:'ravn_long', zone:'asgard', hostId:null, flockId:s[1], activity:'idle', tokens: 8000 + Math.floor(Math.random()*30000), specialty:s[2] });
  });

  // Valkyries
  [
    ['brynhildr','Brynhildr','vanaheim',null,'production guardian','full'],
    ['sigrdrifa','Sigrdrifa','asgard','valhalla','AI/ML workloads','full'],
    ['mist','Mist','alfheim','glitnir','observability','notify'],
    ['svipul','Svipul','midgard','jarnvidr','media services','full'],
    ['hildr','Hildr','svartalfheim','eitri','workshop forge','full'],
    ['gondul','Göndul','yggdrasil',null,'bootstrap','restricted'],
  ].forEach(v => out.push({ id:`valk-${v[0]}`, name:v[1], zone:v[2], cluster:v[3], kind:'valkyrie', activity:'idle', tokens:0, specialty:v[4], autonomy:v[5] }));

  // Models
  [
    ['claude','Claude Sonnet','Anthropic','external','bifrost-1'],
    ['gpt4','GPT-4o','OpenAI','external','bifrost-1'],
    ['gemini','Gemini','Google','external','bifrost-1'],
    ['ollama','Ollama/Local','Local','internal','bifrost-1'],
    ['vllm','vLLM','Local','internal','bifrost-1'],
  ].forEach(m => out.push({ id:`model-${m[0]}`, name:m[1], kind:'model', zone: m[3]==='internal'?'asgard':null, flockId:null, activity:'idle', tokens:0, provider:m[2], location:m[3], bifrost:m[4] }));

  return out;
}

function seedFlocks() { return [{ id:'long',kind:'long',purpose:'persistent agents',state:'resident',bornAt:0 }]; }

let rc=0;
function makeRaid(now) {
  rc++;
  const id = `raid-${rc}`;
  const purposes = ['refactor bifrost rule engine','add mimir page indexing','migrate skuld ws auth','ship ravn persona loader','tune vaka trigger window','audit cerbos policies','backfill chronicler index'];
  const compositions = [
    { m:['coord','skuld'],w:3 },{ m:['coord','reviewer','skuld'],w:4 },
    { m:['coord','reviewer','scholar'],w:2 },{ m:['coord','reviewer','reviewer','skuld'],w:2 },
    { m:['coord','reviewer','scholar','skuld'],w:3 },
  ];
  const tw = compositions.reduce((s,c)=>s+c.w,0); let pick=Math.random()*tw; let chosen=compositions[0];
  for(const c of compositions){ pick-=c.w; if(pick<=0){chosen=c;break;} }
  const cluster = Math.random()<0.6?'eitri':'valaskjalf';
  const zone = cluster==='eitri'?'svartalfheim':'asgard';
  const flock = { id,kind:'raid',purpose:purposes[Math.floor(Math.random()*purposes.length)],state:'forming',bornAt:now,zone,cluster,composition:chosen.m };
  const tn = {coord:'Coord',reviewer:'Reviewer',scholar:'Scholar',skuld:'Skuld'};
  const members = chosen.m.map((type,i)=>{
    const r = { id:`${id}-${type}-${i}`,name:`${tn[type]}-${rc}`,kind:type==='skuld'?'skuld':'ravn_raid',zone,cluster,flockId:id,activity:'idle',tokens:0,role:type };
    if(type==='coord') r.confidence=0.7+Math.random()*0.25;
    return r;
  });
  return { flock, members };
}

function useMockFlokkState(onEvent) {
  const [ravens,setRavens]=useState(()=>seedEntities());
  const [flocks,setFlocks]=useState(()=>seedFlocks());
  const [events,setEvents]=useState([]);
  const [mimir,setMimir]=useState({ pages:1284,writes:0 });
  const [subMimirs]=useState(()=>SUB_MIMIRS.map(m=>({...m})));

  useEffect(()=>{
    const id=setInterval(()=>{
      setRavens(prev=>prev.map(r=>{
        if(Math.random()>0.22)return r;
        const pool=r.kind==='skuld'?['idle','tooling','waiting']:r.kind==='valkyrie'?['idle','thinking','tooling','waiting']:r.kind==='model'?['idle','thinking']:r.kind==='printer'?['idle','tooling']:r.kind==='vaettir'?['idle','waiting']:r.kind==='beacon'?['idle']:r.kind==='service'?['idle','idle','idle','tooling']:r.kind==='host'?['idle']:['idle','thinking','tooling','waiting','delegating','writing','reading'];
        const activity=pool[Math.floor(Math.random()*pool.length)];
        const tokens=r.tokens+(activity==='thinking'?Math.floor(Math.random()*2400):0);
        return {...r,activity,tokens};
      }));
    },900);
    return ()=>clearInterval(id);
  },[]);

  useEffect(()=>{
    const id=setInterval(()=>{
      setEvents(prev=>{
        const next=[...prev]; const now=performance.now();
        while(next.length && now-next[0].t>2800) next.shift();
        const n=1+Math.floor(Math.random()*3);
        for(let i=0;i<n;i++){
          const ev = { id:Math.random().toString(36).slice(2),type:['ravn','tyr','mimir','bifrost'][Math.floor(Math.random()*4)],t:now };
          next.push(ev);
          if(onEvent) onEvent(ev);
        }
        return next;
      });
      if(Math.random()<0.18) setMimir(m=>({pages:m.pages+1,writes:m.writes+1}));
    },420);
    return ()=>clearInterval(id);
  },[onEvent]);

  useEffect(()=>{
    const id=setInterval(()=>{
      setFlocks(prev=>{
        const now=performance.now();
        let next=prev.map(f=>{
          if(f.kind!=='raid')return f;
          const age=now-f.bornAt;
          if(f.state==='forming'&&age>2200) return {...f,state:'working'};
          if(f.state==='working'&&age>16000) return {...f,state:'dissolving'};
          return f;
        }).filter(f=>!(f.kind==='raid'&&f.state==='dissolving'&&now-f.bornAt>19000));
        if(Math.random()<0.35 && next.filter(f=>f.kind==='raid').length<4){
          const raid=makeRaid(now); next=[...next,raid.flock];
          setRavens(rs=>[...rs,...raid.members]);
          if(onEvent) onEvent({ id: raid.flock.id, type:'raid-form', t: now, raidId: raid.flock.id, purpose: raid.flock.purpose });
        }
        setRavens(rs=>rs.filter(r=>{ if(!r.flockId)return true; if(r.flockId==='long')return true;
          if(SUB_MIMIRS.some(m=>m.id===r.flockId))return true; return next.some(f=>f.id===r.flockId); }));
        return next;
      });
    },2400);
    return ()=>clearInterval(id);
  },[onEvent]);

  return { ravens,flocks,events,mimir,subMimirs,realms:REALMS,clusters:CLUSTERS };
}

// ── Layout engine ────────────────────────────────────────────────
function useLayout(ravens,flocks,size,subMimirs,realms,clusters) {
  const posRef=useRef(new Map()); const anchorRef=useRef(new Map());

  useMemo(()=>{
    const {w,h}=size; if(!w||!h)return;
    const zonePos=new Map();
    [...realms,...clusters].forEach(z=>{ zonePos.set(z.id,{ x:z.wx, y:z.wy, r:z.wr }); });
    const vk=zonePos.get('valaskjalf');
    anchorRef.current.set('__node_mimir',{ x:vk.x, y:vk.y });
    anchorRef.current.set('long',{ x:vk.x, y:vk.y });
    const subRing=180;
    subMimirs.forEach((m,i)=>{
      const a=(i/Math.max(1,subMimirs.length))*Math.PI*2-Math.PI/2+Math.PI/subMimirs.length;
      anchorRef.current.set(`__node_${m.id}`,{ x:vk.x+Math.cos(a)*subRing, y:vk.y+Math.sin(a)*subRing });
    });
    ravens.forEach(r=>{
      if(['tyr','bifrost','volundr','printer','vaettir','beacon','service'].includes(r.kind)){
        const anchorZone = r.cluster ? zonePos.get(r.cluster) : zonePos.get(r.zone);
        const zp = anchorZone || zonePos.get(r.zone);
        if(zp){
          const hash=(r.id.charCodeAt(0)*31+r.id.charCodeAt(r.id.length-1)*17)%360;
          const a=hash*Math.PI/180;
          const dist=r.kind==='service'?zp.r*0.45:zp.r*0.35;
          anchorRef.current.set(`__node_${r.id}`,{ x:zp.x+Math.cos(a)*dist, y:zp.y+Math.sin(a)*dist });
        }
      }
    });
    ravens.filter(r=>r.kind==='model').forEach((r,i)=>{
      const bfPos = ravens.find(b=>b.id===r.bifrost);
      const bfAnchor = bfPos ? anchorRef.current.get(`__node_${bfPos.id}`) : null;
      if(r.location==='external'){
        const brealm = zonePos.get('bifrost-realm');
        if(brealm){
          const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
          anchorRef.current.set(`__node_${r.id}`,{ x:brealm.x+Math.cos(a)*brealm.r*0.5, y:brealm.y+Math.sin(a)*brealm.r*0.5 });
        }
      } else if(bfAnchor){
        const a = ((r.id.charCodeAt(r.id.length-1)*37)%360)*Math.PI/180;
        anchorRef.current.set(`__node_${r.id}`,{ x:bfAnchor.x+Math.cos(a)*45, y:bfAnchor.y+Math.sin(a)*45 });
      }
    });
    const hostsByRealm = new Map();
    ravens.filter(r=>r.kind==='host').forEach(r=>{
      if(!hostsByRealm.has(r.zone)) hostsByRealm.set(r.zone,[]);
      hostsByRealm.get(r.zone).push(r);
    });
    hostsByRealm.forEach((hosts,realmId)=>{
      const rp = zonePos.get(realmId); if(!rp) return;
      const ring = rp.r * 0.85;
      const realmClusters = clusters.filter(c=>c.realm===realmId);
      hosts.forEach((r,i)=>{
        let bestA = (i / hosts.length) * Math.PI * 2 + Math.PI * 0.6;
        for(let attempt=0;attempt<36;attempt++){
          const testA = bestA + attempt * (Math.PI * 2 / 36);
          const tx = rp.x+Math.cos(testA)*ring, ty = rp.y+Math.sin(testA)*ring;
          const hr = r.wr||50; let ok = true;
          for(const c of realmClusters){
            const cz = zonePos.get(c.id);
            if(cz && Math.hypot(tx-cz.x,ty-cz.y) < cz.r + hr + 30) { ok=false; break; }
          }
          if(ok) for(let j=0;j<i;j++){
            const prev = anchorRef.current.get(`__node_${hosts[j].id}`);
            if(prev && Math.hypot(tx-prev.x,ty-prev.y) < hr + (hosts[j].wr||50) + 20) { ok=false; break; }
          }
          if(ok){ bestA=testA; break; }
        }
        const pos = { x:rp.x+Math.cos(bestA)*ring, y:rp.y+Math.sin(bestA)*ring };
        anchorRef.current.set(`__node_${r.id}`,pos);
        zonePos.set(r.id,{ x:pos.x, y:pos.y, r:r.wr||50 });
      });
    });
    ravens.filter(r=>r.kind==='valkyrie').forEach(r=>{
      const zp = r.cluster ? zonePos.get(r.cluster) : zonePos.get(r.zone);
      if(zp) anchorRef.current.set(`__node_${r.id}`,{ x:zp.x, y:zp.y - zp.r*0.75 });
    });
    const raids=flocks.filter(f=>f.kind==='raid');
    const raidsByCluster = new Map();
    raids.forEach(f=>{
      const k = f.cluster||'valaskjalf';
      if(!raidsByCluster.has(k)) raidsByCluster.set(k,[]);
      raidsByCluster.get(k).push(f);
    });
    raidsByCluster.forEach((clusterRaids,clusterId)=>{
      const zp=zonePos.get(clusterId); if(!zp) return;
      const baseRing = zp.r * 0.80, ringStep = 50;
      clusterRaids.forEach((f,i)=>{
        const ring = baseRing + Math.floor(i / 3) * ringStep;
        const a = (i % 3) / 3 * Math.PI + Math.PI * 0.25;
        anchorRef.current.set(f.id,{ x:zp.x+Math.cos(a)*ring, y:zp.y+Math.sin(a)*ring });
      });
    });
  },[flocks,size,subMimirs,realms,clusters,ravens]);

  useMemo(()=>{
    const {w,h}=size; if(!w||!h)return;
    ravens.forEach(r=>{
      if(posRef.current.has(r.id))return;
      if(r.hostId){
        const ha=anchorRef.current.get(`__node_${r.hostId}`);
        if(ha){
          const a=Math.random()*Math.PI*2;
          posRef.current.set(r.id,{ x:ha.x+Math.cos(a)*25, y:ha.y+Math.sin(a)*25, vx:0, vy:0 });
          return;
        }
      }
      if(r.kind==='ravn_long'&&r.flockId==='long'){
        const vk=CLUSTERS.find(z=>z.id==='valaskjalf');
        const longs=ravens.filter(x=>x.kind==='ravn_long'&&x.flockId==='long');
        const idx=longs.findIndex(x=>x.id===r.id);
        const a=(idx/Math.max(1,longs.length))*Math.PI*2+Math.PI/longs.length;
        posRef.current.set(r.id,{ x:vk.wx+Math.cos(a)*120, y:vk.wy+Math.sin(a)*120, vx:0, vy:0 });
        return;
      }
      const ak=r.flockId??`__node_${r.id}`;
      const a=anchorRef.current.get(ak)??{x:WORLD_W/2,y:WORLD_H/2};
      posRef.current.set(r.id,{ x:a.x+(Math.random()-0.5)*80, y:a.y+(Math.random()-0.5)*80, vx:0, vy:0 });
    });
    subMimirs.forEach(m=>{
      if(!posRef.current.has(m.id)){
        const a=anchorRef.current.get(`__node_${m.id}`)??{x:WORLD_W/2,y:WORLD_H/2};
        posRef.current.set(m.id,{x:a.x,y:a.y,vx:0,vy:0});
      }
    });
    const ids=new Set(ravens.map(r=>r.id).concat(subMimirs.map(m=>m.id)));
    for(const id of Array.from(posRef.current.keys())) if(!ids.has(id)) posRef.current.delete(id);
  },[ravens,size,subMimirs]);

  const step=useCallback((dt)=>{
    const P=posRef.current, A=anchorRef.current;
    const mp=P.get('mimir'),ma=A.get('__node_mimir');
    if(mp&&ma){ mp.vx+=(ma.x-mp.x)*0.22*dt; mp.vy+=(ma.y-mp.y)*0.22*dt; }
    subMimirs.forEach(m=>{
      const p=P.get(m.id); if(!p)return;
      const a=A.get(`__node_${m.id}`); if(!a)return;
      p.vx+=(a.x-p.x)*0.10*dt; p.vy+=(a.y-p.y)*0.10*dt;
      p.vx*=0.86; p.vy*=0.86; p.x+=p.vx*dt; p.y+=p.vy*dt;
    });
    ravens.forEach(r=>{
      const p=P.get(r.id); if(!p)return;
      const subA=r.flockId?subMimirs.find(m=>m.id===r.flockId):null;
      if(subA){ const sp=P.get(subA.id); if(!sp)return;
        const dx=p.x-sp.x,dy=p.y-sp.y,d=Math.hypot(dx,dy)||1;
        const nx=sp.x+(dx/d)*80,ny=sp.y+(dy/d)*80;
        p.vx+=(nx-p.x)*0.08*dt; p.vy+=(ny-p.y)*0.08*dt; return; }
      if(r.hostId){
        const hp=P.get(r.hostId); if(!hp)return;
        const dx=p.x-hp.x,dy=p.y-hp.y,d=Math.hypot(dx,dy)||1;
        const hostWr = (ravens.find(h=>h.id===r.hostId)||{}).wr||50;
        const orbit = hostWr * 0.45;
        const nx=hp.x+(dx/d)*orbit,ny=hp.y+(dy/d)*orbit;
        p.vx+=(nx-p.x)*0.10*dt; p.vy+=(ny-p.y)*0.10*dt; return; }
      if(r.flockId==='long'){ const mp2=P.get('mimir'); if(!mp2)return;
        const dx=p.x-mp2.x,dy=p.y-mp2.y,d=Math.hypot(dx,dy)||1;
        const orbit=120;
        const nx=mp2.x+(dx/d)*orbit,ny=mp2.y+(dy/d)*orbit;
        p.vx+=(nx-p.x)*0.05*dt; p.vy+=(ny-p.y)*0.05*dt; return; }
      const ak=r.flockId??`__node_${r.id}`;
      const a=A.get(ak); if(!a)return;
      const pull=['tyr','bifrost','volundr','model','valkyrie','printer','vaettir','beacon','service','host'].includes(r.kind)?0.14:0.022;
      p.vx+=(a.x-p.x)*pull*dt; p.vy+=(a.y-p.y)*pull*dt;
    });
    const arr=[...ravens];
    for(let i=0;i<arr.length;i++){
      const pa=P.get(arr[i].id); if(!pa)continue;
      for(let j=i+1;j<arr.length;j++){
        const pb=P.get(arr[j].id); if(!pb)continue;
        const dx=pb.x-pa.x,dy=pb.y-pa.y,d2=dx*dx+dy*dy;
        if(d2>160*160||d2<0.01)continue;
        const d=Math.sqrt(d2),f=420/d2,fx=(dx/d)*f,fy=(dy/d)*f;
        pa.vx-=fx*dt; pa.vy-=fy*dt; pb.vx+=fx*dt; pb.vy+=fy*dt;
      }
    }
    P.forEach(p=>{ p.vx*=0.86; p.vy*=0.86; p.x+=p.vx*dt; p.y+=p.vy*dt; });
  },[ravens,subMimirs]);

  return { positions:posRef.current, anchors:anchorRef.current, step };
}

// ── Drawing helpers ──────────────────────────────────────────────
// Orbiting Younger Futhark-ish glyphs around Mímir. We intentionally exclude
// runes that have been appropriated as hate symbols (Othala ᛟ, Sowilo ᛊ,
// Tiwaz ᛏ, and Algiz ᛉ) — see ADL hate symbol database.
const MIMIR_RUNES=['ᚠ','ᚢ','ᚦ','ᚨ','ᚱ','ᚲ','ᚷ','ᚹ','ᚾ','ᛁ','ᛃ','ᛈ','ᛒ','ᛖ','ᛗ','ᛚ','ᛜ','ᛞ'];

function drawZones(ctx,realms,clusters,now) {
  realms.forEach(z=>{
    const cx=z.wx, cy=z.wy, r=z.wr;
    const g=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
    g.addColorStop(0,'rgba(30,48,78,0.38)');
    g.addColorStop(0.65,'rgba(20,32,56,0.16)');
    g.addColorStop(1,'rgba(14,20,36,0.02)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle=`rgba(147,197,253,${0.28+0.06*Math.sin(now/5000+z.vlan*0.1)})`;
    ctx.lineWidth=1; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle='rgba(186,230,253,0.78)';
    ctx.font='600 13px Inter, sans-serif'; ctx.textAlign='center';
    ctx.fillText(z.label.toUpperCase(),cx,cy-r-30);
    ctx.fillStyle='rgba(148,163,184,0.52)';
    ctx.font='10px "JetBrainsMono NF", monospace';
    ctx.fillText(`${z.dns}  ·  VLAN ${z.vlan}`,cx,cy-r-16);
  });
  clusters.forEach(c=>{
    const cx=c.wx, cy=c.wy, r=c.wr;
    const g=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
    g.addColorStop(0,'rgba(40,58,88,0.22)'); g.addColorStop(1,'rgba(20,28,48,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(147,197,253,0.26)'; ctx.lineWidth=0.9;
    ctx.setLineDash([4,5]); ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle='rgba(186,230,253,0.58)'; ctx.font='10px "JetBrainsMono NF", monospace'; ctx.textAlign='center';
    ctx.fillText(`⎔ ${c.label}`,cx,cy-r-6);
    ctx.fillStyle='rgba(120,145,180,0.40)'; ctx.font='9px "JetBrainsMono NF", monospace';
    ctx.fillText(c.purpose,cx,cy-r+6);
  });
}

function drawInfraTopology(ctx,ravens,positions,now) {
  const tyrs=ravens.filter(r=>r.kind==='tyr');
  const volundrs=ravens.filter(r=>r.kind==='volundr');
  const bifrosts=ravens.filter(r=>r.kind==='bifrost');
  const models=ravens.filter(r=>r.kind==='model');

  // Týr → Völundrs (solid thin)
  tyrs.forEach(t=>{
    const tp=positions.get(t.id); if(!tp)return;
    volundrs.forEach(v=>{
      const vp=positions.get(v.id); if(!vp)return;
      ctx.strokeStyle='rgba(147,197,253,0.32)';
      ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(tp.x,tp.y); ctx.lineTo(vp.x,vp.y); ctx.stroke();
    });
  });
  // Bifröst → models (dashed for external, solid for internal)
  bifrosts.forEach(b=>{
    const bp=positions.get(b.id); if(!bp)return;
    models.forEach(m=>{
      const mp=positions.get(m.id); if(!mp)return;
      if(m.bifrost && m.bifrost!==b.id) return;
      const active=m.activity==='thinking';
      const external=m.location==='external';
      ctx.strokeStyle=rgba(C.indigo,active?0.55:external?0.22:0.32);
      ctx.lineWidth=active?1.3:0.9;
      if(external){ ctx.setLineDash([6,4]); ctx.lineDashOffset=-now/120; }
      ctx.beginPath(); ctx.moveTo(bp.x,bp.y); ctx.lineTo(mp.x,mp.y); ctx.stroke();
      if(external) ctx.setLineDash([]);
    });
  });
  // Týr → raid coord (dashed animated — dispatch channel)
  tyrs.forEach(t=>{
    const tp=positions.get(t.id); if(!tp)return;
    ravens.filter(r=>r.role==='coord').forEach(c=>{
      const cp=positions.get(c.id); if(!cp)return;
      ctx.strokeStyle='rgba(125,211,252,0.38)';
      ctx.lineWidth=1;
      ctx.setLineDash([3,5]); ctx.lineDashOffset=-now/80;
      ctx.beginPath(); ctx.moveTo(tp.x,tp.y); ctx.lineTo(cp.x,cp.y); ctx.stroke();
      ctx.setLineDash([]);
    });
  });
}

function drawEdges(ctx,ravens,flocks,positions,now,subMimirs) {
  ctx.save(); ctx.lineCap='round';
  const mimir=positions.get('mimir');
  const bifrosts=ravens.filter(r=>r.kind==='bifrost');
  bifrosts.forEach(b=>{
    const bp=positions.get(b.id); if(!bp)return;
    ravens.filter(r=>r.activity==='thinking'&&['ravn_long','ravn_raid'].includes(r.kind)).forEach(r=>{
      const p=positions.get(r.id); if(!p)return;
      ctx.strokeStyle=rgba(C.indigo,0.30+0.10*Math.sin(now/500+p.x));
      ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(bp.x,bp.y); ctx.stroke();
    });
  });
  ravens.filter(r=>r.kind==='ravn_long').forEach(r=>{
    const p=positions.get(r.id); if(!p)return;
    const tid=(r.flockId&&subMimirs.some(m=>m.id===r.flockId))?r.flockId:'mimir';
    const t=positions.get(tid); if(!t)return;
    const glow=r.activity==='writing'||r.activity==='reading'?0.50:0.18;
    ctx.strokeStyle=rgba(C.moon,glow); ctx.lineWidth=0.9;
    ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(t.x,t.y); ctx.stroke();
  });
  if(mimir) subMimirs.forEach(m=>{
    const p=positions.get(m.id); if(!p)return;
    ctx.strokeStyle=rgba(C.moon,0.24); ctx.lineWidth=1;
    ctx.setLineDash([3,4]); ctx.beginPath(); ctx.moveTo(mimir.x,mimir.y); ctx.lineTo(p.x,p.y); ctx.stroke(); ctx.setLineDash([]);
  });
  flocks.filter(f=>f.kind==='raid').forEach(f=>{
    const ms=ravens.filter(r=>r.flockId===f.id);
    for(let i=0;i<ms.length;i++) for(let j=i+1;j<ms.length;j++){
      const a=positions.get(ms[i].id),b=positions.get(ms[j].id);
      if(!a||!b)continue;
      ctx.strokeStyle=rgba(C.frost,0.38); ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    }
  });
  ctx.restore();
}

function drawParticles(ctx,particles,positions,now) {
  for(let i=particles.length-1;i>=0;i--){
    const pt=particles[i];
    const a=positions.get(pt.fromId),b=positions.get(pt.toId);
    if(!a||!b){particles.splice(i,1);continue;}
    const prog=(now-pt.born)/pt.dur;
    if(prog>=1){particles.splice(i,1);continue;}
    const x=a.x+(b.x-a.x)*prog,y=a.y+(b.y-a.y)*prog;
    const c=C[pt.type==='bifrost'?'indigo':pt.type==='mimir'?'moon':pt.type==='tyr'?'frost':'ice'];
    const g=ctx.createRadialGradient(x,y,0,x,y,12);
    g.addColorStop(0,rgba(c,0.9)); g.addColorStop(1,rgba(c,0));
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,12,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=rgba(c,1); ctx.beginPath(); ctx.arc(x,y,2,0,Math.PI*2); ctx.fill();
  }
}

function drawRaidHalo(ctx,members,positions,flock,now) {
  let cx=0,cy=0,n=0;
  members.forEach(m=>{const p=positions.get(m.id);if(p){cx+=p.x;cy+=p.y;n++;}});
  if(!n)return; cx/=n; cy/=n;
  let rMax=40;
  members.forEach(m=>{const p=positions.get(m.id);if(!p)return;const d=Math.hypot(p.x-cx,p.y-cy);if(d>rMax)rMax=d;});
  rMax+=28;
  const age=now-flock.bornAt;
  let alpha=0.10;
  if(flock.state==='forming') alpha=0.05+0.14*Math.min(1,age/2200);
  if(flock.state==='dissolving') alpha=0.22*Math.max(0,1-(age-16000)/3000);
  if(flock.state==='working') alpha=0.10+0.05*Math.sin(now/600);
  const g=ctx.createRadialGradient(cx,cy,rMax*0.2,cx,cy,rMax);
  g.addColorStop(0,rgba(C.frost,alpha)); g.addColorStop(1,rgba(C.frost,0));
  ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,rMax,0,Math.PI*2); ctx.fill();
  if(flock.state==='forming'&&age<2200){
    const t=age/2200; ctx.strokeStyle=rgba(C.moon,0.55*(1-t));
    ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(cx,cy,rMax*0.4+rMax*1.4*t,0,Math.PI*2); ctx.stroke();
  }
  if(flock.state==='dissolving'){
    const t=Math.max(0,(age-16000)/3000);
    for(let i=0;i<12;i++){
      const a=(i/12)*Math.PI*2+flock.bornAt*0.001;
      const rS=rMax*0.6+t*rMax*0.4, rE=rS+22+t*30;
      ctx.strokeStyle=rgba(C.moon,0.45*(1-t)); ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(cx+Math.cos(a)*rS,cy+Math.sin(a)*rS);
      ctx.lineTo(cx+Math.cos(a)*rE,cy+Math.sin(a)*rE); ctx.stroke();
    }
  }
  if(flock.state!=='forming'||age>1200){
    const la=flock.state==='dissolving'?Math.max(0,1-(age-16000)/2500)*0.7:0.55;
    ctx.fillStyle=rgba(C.moon,la); ctx.font='11px "JetBrainsMono NF", monospace'; ctx.textAlign='center';
    ctx.fillText(flock.purpose,cx,cy-rMax-8);
    ctx.fillStyle=rgba(C.slate,la*0.75); ctx.font='9px "JetBrainsMono NF", monospace';
    ctx.fillText(flock.state.toUpperCase(),cx,cy-rMax+6);
  }
}

function drawMimir(ctx,p,now,scale=1,label='MIMIR') {
  const R=42*scale;
  const neb=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,R*2.6);
  neb.addColorStop(0,rgba({r:210,g:230,b:255},0.62*Math.min(1,scale+0.2)));
  neb.addColorStop(0.35,rgba({r:180,g:210,b:245},0.22*Math.min(1,scale+0.2)));
  neb.addColorStop(1,'rgba(180,210,245,0)');
  ctx.fillStyle=neb; ctx.beginPath(); ctx.arc(p.x,p.y,R*2.6,0,Math.PI*2); ctx.fill();
  const inner=ctx.createRadialGradient(p.x,p.y,R*0.6,p.x,p.y,R*1.1);
  inner.addColorStop(0,'rgba(230,240,255,0)');
  inner.addColorStop(1,rgba({r:200,g:225,b:255},0.38*Math.min(1,scale+0.2)));
  ctx.fillStyle=inner; ctx.beginPath(); ctx.arc(p.x,p.y,R*1.1,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='rgba(9,9,11,0.95)'; ctx.beginPath(); ctx.arc(p.x,p.y,R,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle=rgba({r:200,g:225,b:255},0.60*Math.min(1,scale+0.2)); ctx.lineWidth=1.3;
  ctx.beginPath(); ctx.arc(p.x,p.y,R,0,Math.PI*2); ctx.stroke();
  ctx.font=`${Math.round(13*scale)}px "JetBrainsMono NF", monospace`; ctx.textAlign='center'; ctx.textBaseline='middle';
  const n=Math.round(16*Math.min(1,scale+0.3));
  for(let i=0;i<n;i++){
    const a=i/n*Math.PI*2+now/6000;
    ctx.fillStyle=rgba({r:210,g:230,b:255},0.62+0.25*Math.sin(now/700+i));
    ctx.fillText(MIMIR_RUNES[i%MIMIR_RUNES.length],p.x+Math.cos(a)*(R+10*scale),p.y+Math.sin(a)*(R+10*scale));
  }
  if(scale>=0.9){
    ctx.font='11px "JetBrainsMono NF", monospace';
    for(let i=0;i<n-4;i++){
      const a=-(i/(n-4))*Math.PI*2+now/4200;
      ctx.fillStyle=rgba({r:170,g:200,b:240},0.32+0.20*Math.cos(now/500+i));
      ctx.fillText(MIMIR_RUNES[(i+7)%MIMIR_RUNES.length],p.x+Math.cos(a)*(R+28),p.y+Math.sin(a)*(R+28));
    }
  }
  ctx.fillStyle=rgba({r:210,g:230,b:255},scale>=0.9?0.9:0.70);
  ctx.font=`600 ${Math.round(11*Math.max(0.85,scale))}px Inter, sans-serif`;
  ctx.textBaseline='alphabetic';
  ctx.fillText(label,p.x,p.y+R+(scale>=0.9?42:22));
}

function drawMimirOrbit(ctx,p,mimir) {
  ctx.fillStyle=rgba(C.slate,0.65); ctx.font='10px "JetBrainsMono NF", monospace'; ctx.textAlign='center';
  ctx.fillText(`${mimir.pages} pages · ${mimir.writes} writes`,p.x,p.y-92);
}

function drawStars(ctx,w,h,now) {
  ctx.save();
  for(let i=0;i<26;i++) for(let j=0;j<14;j++){
    const seed=(i*91+j*53)%997;
    const tw=0.45+0.55*Math.sin(now/1400+seed);
    const x=(seed*13)%w, y=(seed*31)%h;
    ctx.fillStyle=`rgba(186,230,253,${0.10+0.22*tw})`;
    ctx.fillRect(x,y,1,1);
  }
  ctx.restore();
}

// Host container — rounded rectangle with subtle fill
function drawHost(ctx,r,p,now,hover) {
  const w = (r.wr||50)*2, h = (r.wr||50)*1.5;
  const x = p.x - w/2, y = p.y - h/2;
  ctx.save();
  ctx.fillStyle = hover ? 'rgba(45,55,78,0.6)' : 'rgba(27,35,54,0.42)';
  roundRect(ctx,x,y,w,h,10);
  ctx.fill();
  ctx.strokeStyle = hover ? rgba(C.ice,0.55) : 'rgba(148,163,184,0.35)';
  ctx.lineWidth = hover ? 1.4 : 1;
  roundRect(ctx,x,y,w,h,10); ctx.stroke();
  // label top
  ctx.fillStyle=rgba(C.moon,0.78);
  ctx.font='600 10px Inter, sans-serif'; ctx.textAlign='left';
  ctx.fillText(r.name,x+8,y+14);
  ctx.fillStyle=rgba(C.slate,0.55); ctx.font='9px "JetBrainsMono NF", monospace';
  ctx.fillText(r.hw||'',x+8,y+26);
  ctx.restore();
}
function roundRect(ctx,x,y,w,h,r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

function activityGlow(activity) {
  return ({idle:0.35,thinking:1,tooling:0.8,waiting:0.45,delegating:0.85,writing:0.9,reading:0.65})[activity] ?? 0.5;
}

// Kind → renderer dispatch
function drawNode(ctx,r,p,now,hover) {
  if(r.kind==='host') return drawHost(ctx,r,p,now,hover);
  if(r.kind==='mimir') return; // handled separately
  const size = KIND_R[r.kind] || 8;
  const glow = activityGlow(r.activity);
  const col =
    r.kind==='tyr' ? C.frost :
    r.kind==='bifrost' ? C.indigo :
    r.kind==='volundr' ? C.moon :
    r.kind==='valkyrie' ? C.valk :
    r.kind==='model' ? C.model :
    r.kind==='ravn_long' ? C.moon :
    r.kind==='ravn_raid' ? C.ice :
    r.kind==='skuld' ? C.indigo :
    r.kind==='printer' ? C.device :
    r.kind==='vaettir' ? C.device :
    r.kind==='beacon' ? C.dim :
    r.kind==='service' ? C.ice :
    C.slate;
  // glow halo for active
  if(r.activity==='thinking' || r.activity==='tooling' || r.activity==='writing') {
    const g = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,size*3);
    g.addColorStop(0,rgba(col,0.30*glow)); g.addColorStop(1,rgba(col,0));
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(p.x,p.y,size*3,0,Math.PI*2); ctx.fill();
  }
  if(hover) {
    ctx.strokeStyle=rgba(C.moon,0.8); ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(p.x,p.y,size+5,0,Math.PI*2); ctx.stroke();
  }
  // shape per kind
  ctx.save();
  switch(r.kind) {
    case 'tyr':
    case 'volundr':
      ctx.fillStyle=rgba(col,0.92);
      ctx.fillRect(p.x-size,p.y-size,size*2,size*2);
      break;
    case 'bifrost': {
      ctx.fillStyle=rgba(col,0.92);
      ctx.beginPath();
      for(let k=0;k<5;k++){ const a=-Math.PI/2+k/5*Math.PI*2; const rr=size;
        const x=p.x+Math.cos(a)*rr,y=p.y+Math.sin(a)*rr;
        if(k===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'ravn_long':
      ctx.fillStyle=rgba(col,0.95);
      ctx.beginPath();
      ctx.moveTo(p.x,p.y-size); ctx.lineTo(p.x+size,p.y);
      ctx.lineTo(p.x,p.y+size); ctx.lineTo(p.x-size,p.y); ctx.closePath();
      ctx.fill();
      break;
    case 'ravn_raid':
      ctx.fillStyle=rgba(col,0.9);
      ctx.beginPath();
      ctx.moveTo(p.x,p.y-size); ctx.lineTo(p.x+size,p.y+size*0.7);
      ctx.lineTo(p.x-size,p.y+size*0.7); ctx.closePath();
      ctx.fill();
      break;
    case 'skuld':
      ctx.fillStyle='rgba(9,9,11,0.8)';
      ctx.strokeStyle=rgba(col,0.9); ctx.lineWidth=1.4;
      ctx.beginPath();
      for(let k=0;k<6;k++){ const a=-Math.PI/2+k/6*Math.PI*2;
        const x=p.x+Math.cos(a)*size,y=p.y+Math.sin(a)*size;
        if(k===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    case 'valkyrie':
      ctx.fillStyle=rgba(col,0.95);
      ctx.beginPath();
      ctx.moveTo(p.x-size,p.y+size*0.6); ctx.lineTo(p.x,p.y-size);
      ctx.lineTo(p.x+size,p.y+size*0.6); ctx.lineTo(p.x,p.y+size*0.25); ctx.closePath();
      ctx.fill();
      break;
    case 'printer':
    case 'vaettir':
      ctx.strokeStyle=rgba(col,0.9); ctx.lineWidth=1.3;
      ctx.strokeRect(p.x-size,p.y-size,size*2,size*2);
      ctx.fillStyle=rgba(col,0.25);
      ctx.fillRect(p.x-size,p.y-size,size*2,size*2);
      break;
    case 'beacon':
      ctx.strokeStyle=rgba(col,0.6); ctx.lineWidth=1;
      ctx.setLineDash([2,2]); ctx.beginPath(); ctx.arc(p.x,p.y,size,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle=rgba(col,0.6);
      ctx.beginPath(); ctx.arc(p.x,p.y,2,0,Math.PI*2); ctx.fill();
      break;
    case 'service':
      ctx.fillStyle=rgba(col,0.85);
      ctx.beginPath(); ctx.arc(p.x,p.y,size,0,Math.PI*2); ctx.fill();
      break;
    case 'model':
      ctx.fillStyle=rgba(col,0.8);
      ctx.beginPath(); ctx.arc(p.x,p.y,size,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle=rgba(C.indigo,0.45); ctx.lineWidth=0.8;
      ctx.stroke();
      break;
    default:
      ctx.fillStyle=rgba(col,0.85);
      ctx.beginPath(); ctx.arc(p.x,p.y,size,0,Math.PI*2); ctx.fill();
  }
  ctx.restore();

  // Labels on big / hovered
  if(['tyr','bifrost','volundr','valkyrie','ravn_long'].includes(r.kind) || hover) {
    ctx.fillStyle=rgba(C.moon,hover?0.95:0.75);
    ctx.font=`${hover?600:500} 10px Inter, sans-serif`;
    ctx.textAlign='center';
    ctx.fillText(r.name, p.x, p.y + size + 13);
  }
  // Rune for long ravens — drawn inside diamond
  if(r.kind==='ravn_long' && r.rune) {
    ctx.fillStyle='rgba(9,9,11,0.95)';
    ctx.font='700 9px "JetBrainsMono NF", monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(r.rune, p.x, p.y+1);
    ctx.textBaseline='alphabetic';
  }
  // Identity rune for coordinator nodes (Tyr=ᛃ, Bifrost=ᚨ, Volundr=ᚲ)
  if(['tyr','bifrost','volundr'].includes(r.kind)) {
    const rn = r.kind==='tyr'?'ᛃ':r.kind==='bifrost'?'ᚨ':'ᚲ';
    ctx.fillStyle='rgba(9,9,11,0.88)';
    ctx.font='700 12px "JetBrainsMono NF", monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(rn, p.x, p.y+1);
    ctx.textBaseline='alphabetic';
  }
}

// ── Canvas view ─────────────────────────────────────────────────

function Observatory({ state, onHover, onClick, onSelect, hoveredId, selectedId, showMinimap=true }) {
  const { ravens, flocks, events, mimir, subMimirs, realms, clusters } = state;
  const canvasRef=useRef(null); const rafRef=useRef(0);
  const sizeRef=useRef({w:0,h:0}); const [size,setSize]=useState({w:0,h:0});
  const { positions, step } = useLayout(ravens,flocks,size,subMimirs,realms,clusters);
  const particlesRef=useRef([]);
  const camRef=useRef({ x: WORLD_W/2, y: WORLD_H/2, zoom: 0.32 });
  const dragRef=useRef({active:false,startX:0,startY:0,startCamX:0,startCamY:0});
  const [,forceUpdate]=useState(0);

  const s2w=useCallback((sx,sy)=>{
    const {w,h}=sizeRef.current; const cam=camRef.current;
    return { x:(sx-w/2)/cam.zoom+cam.x, y:(sy-h/2)/cam.zoom+cam.y };
  },[]);

  useEffect(()=>{
    if(!events.length)return;
    const last=events[events.length-1]; const live=ravens;
    let from=null,to=null;
    if(last.type==='bifrost'){ from=live[Math.floor(Math.random()*live.length)]; to=ravens.find(r=>r.kind==='bifrost'); }
    else if(last.type==='mimir'){ from=live[Math.floor(Math.random()*live.length)]; to=ravens.find(r=>r.id==='mimir'); }
    else if(last.type==='tyr'){ from=ravens.find(r=>r.kind==='tyr'); const raids=flocks.filter(f=>f.kind==='raid'); const raid=raids[Math.floor(Math.random()*raids.length)]; to=raid?live.find(r=>r.flockId===raid.id&&r.role==='coord'):null; }
    else { const longs=live.filter(r=>r.kind==='ravn_long'); from=longs[Math.floor(Math.random()*longs.length)]; to=longs[Math.floor(Math.random()*longs.length)]; if(from===to) to=ravens.find(r=>r.id==='mimir'); }
    if(from&&to&&from.id!==to.id) particlesRef.current.push({ fromId:from.id,toId:to.id,type:last.type,born:performance.now(),dur:1200+Math.random()*600 });
  },[events,ravens,flocks]);

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas)return;
    const apply=(width,height)=>{
      if(!width||!height)return;
      const dpr=window.devicePixelRatio||1;
      canvas.width=width*dpr; canvas.height=height*dpr;
      canvas.style.width=`${width}px`; canvas.style.height=`${height}px`;
      sizeRef.current={w:width,h:height}; setSize({w:width,h:height});
    };
    // Initial size pass (some layouts race with ResizeObserver).
    apply(canvas.clientWidth, canvas.clientHeight);
    requestAnimationFrame(()=>apply(canvas.clientWidth, canvas.clientHeight));
    const ro=new ResizeObserver(entries=>{
      const {width,height}=entries[0].contentRect;
      apply(width,height);
    });
    ro.observe(canvas); return ()=>ro.disconnect();
  },[]);

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas)return;
    const onWheel=(e)=>{
      e.preventDefault(); const cam=camRef.current;
      const rect=canvas.getBoundingClientRect();
      const mx=e.clientX-rect.left,my=e.clientY-rect.top;
      const {w,h}=sizeRef.current;
      const zf=e.deltaY<0?1.12:1/1.12;
      const nz=Math.max(0.15,Math.min(5,cam.zoom*zf));
      cam.x=(mx-w/2)/cam.zoom+cam.x-(mx-w/2)/nz;
      cam.y=(my-h/2)/cam.zoom+cam.y-(my-h/2)/nz;
      cam.zoom=nz; forceUpdate(n=>n+1);
    };
    canvas.addEventListener('wheel',onWheel,{passive:false});
    return ()=>canvas.removeEventListener('wheel',onWheel);
  },[]);

  // Pack latest drawing data into refs so the rAF loop can read fresh values
  // without re-subscribing on every state tick.
  const drawRef = useRef({});
  drawRef.current = { ravens, flocks, positions, step, hoveredId, selectedId, mimir, subMimirs, realms, clusters, showMinimap };

  useEffect(()=>{
    const canvas=canvasRef.current;
    if(!canvas) return;
    console.log('[obs] render loop init');
    const ctx=canvas.getContext('2d'); let lastT=performance.now();
    let cancelled = false;
    let frameN = 0;
    const render=(now)=>{
      if (cancelled) return;
      frameN++;
      if (frameN<=2||frameN===60) console.log('[obs] frame', frameN, 'size', sizeRef.current);
      const { ravens, flocks, positions, step, hoveredId, selectedId, mimir, subMimirs, realms, clusters, showMinimap } = drawRef.current;
      const dt=Math.min(2,(now-lastT)/16.6667); lastT=now; step&&step(dt);
      const {w,h}=sizeRef.current;
      if(!w||!h) return;
      const dpr=window.devicePixelRatio||1; const cam=camRef.current;
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.clearRect(0,0,w,h);
      const bg=ctx.createRadialGradient(w/2,h/2,0,w/2,h/2,Math.max(w,h)*0.7);
      bg.addColorStop(0,'#0a0c12'); bg.addColorStop(1,'#050509');
      ctx.fillStyle=bg; ctx.fillRect(0,0,w,h);
      drawStars(ctx,w,h,now);
      ctx.save();
      ctx.translate(w/2,h/2); ctx.scale(cam.zoom,cam.zoom); ctx.translate(-cam.x,-cam.y);

      const dynRealms = realms.map(z=>{
        let maxDist=0;
        ravens.forEach(r=>{ if(r.zone!==z.id) return; const p=positions.get(r.id); if(!p) return;
          const d=Math.hypot(p.x-z.wx,p.y-z.wy); if(d>maxDist) maxDist=d; });
        return { ...z, wr: Math.max(z.wr, maxDist + 60) };
      });
      const dynClusters = clusters.map(c=>{
        let maxDist=0;
        ravens.forEach(r=>{ if(r.cluster!==c.id) return; const p=positions.get(r.id); if(!p) return;
          const d=Math.hypot(p.x-c.wx,p.y-c.wy); if(d>maxDist) maxDist=d; });
        return { ...c, wr: maxDist>0 ? Math.max(c.wr, maxDist + 40) : c.wr };
      });
      drawZones(ctx,dynRealms,dynClusters,now);
      drawInfraTopology(ctx,ravens,positions,now);
      drawEdges(ctx,ravens,flocks,positions,now,subMimirs);
      flocks.forEach(f=>{
        if(f.kind!=='raid')return;
        const members=ravens.filter(r=>r.flockId===f.id);
        if(!members.length)return;
        drawRaidHalo(ctx,members,positions,f,now);
      });
      drawParticles(ctx,particlesRef.current,positions,now);
      subMimirs.forEach(m=>{ const p=positions.get(m.id); if(p) drawMimir(ctx,p,now,0.4,m.name); });
      ravens.filter(r=>r.kind==='host').forEach(r=>{ const p=positions.get(r.id); if(p) drawNode(ctx,r,p,now,r.id===hoveredId||r.id===selectedId); });
      ravens.filter(r=>r.kind!=='host'&&r.kind!=='mimir').forEach(r=>{ const p=positions.get(r.id); if(p) drawNode(ctx,r,p,now,r.id===hoveredId||r.id===selectedId); });
      const mEntity = ravens.find(r=>r.id==='mimir');
      const mp=positions.get('mimir');
      if(mp) { drawMimir(ctx,mp,now,1,'MIMIR'); drawMimirOrbit(ctx,mp,mimir); }

      ctx.restore();

      if(showMinimap) ctx.setTransform(dpr,0,0,dpr,0,0);
    };
    // Drive with setInterval + rAF — some iframe hosts (preview panes) drop rAF
    // callbacks. Using a setInterval at ~16ms guarantees the loop progresses;
    // rAF inside schedules a single repaint-aligned draw when the tab is visible.
    const tick = () => {
      if (cancelled) return;
      requestAnimationFrame(render);
    };
    render(performance.now());
    const intervalId = setInterval(tick, 16);
    return ()=>{ cancelled = true; clearInterval(intervalId); };
  },[]);

  const hit=useCallback((sx,sy)=>{
    const {x:wx,y:wy}=s2w(sx,sy);
    for(const r of ravens){
      const p=positions.get(r.id); if(!p)continue;
      const hr=['tyr','bifrost','volundr'].includes(r.kind)?18:r.kind==='mimir'?42:r.kind==='beacon'?7:r.kind==='service'?8:(KIND_R[r.kind]||8)+6;
      if(r.kind==='host'){
        const w = (r.wr||50)*2, h = (r.wr||50)*1.5;
        if(Math.abs(wx-p.x)<w/2 && Math.abs(wy-p.y)<h/2) return r;
      } else {
        const dx=wx-p.x,dy=wy-p.y;
        if(dx*dx+dy*dy<hr*hr)return r;
      }
    }
    return null;
  },[ravens,positions,s2w]);

  const handleMove=(e)=>{
    const rect=canvasRef.current.getBoundingClientRect();
    const sx=e.clientX-rect.left,sy=e.clientY-rect.top;
    const drag=dragRef.current;
    if(drag.active){ const cam=camRef.current;
      cam.x=drag.startCamX-(sx-drag.startX)/cam.zoom;
      cam.y=drag.startCamY-(sy-drag.startY)/cam.zoom;
      canvasRef.current.style.cursor='grabbing'; forceUpdate(n=>n+1); return; }
    const r=hit(sx,sy); onHover&&onHover(r?.id??null); canvasRef.current.style.cursor=r?'pointer':'grab';
  };
  const handleDown=(e)=>{
    const rect=canvasRef.current.getBoundingClientRect();
    const sx=e.clientX-rect.left,sy=e.clientY-rect.top;
    if(hit(sx,sy))return;
    const cam=camRef.current;
    dragRef.current={active:true,startX:sx,startY:sy,startCamX:cam.x,startCamY:cam.y};
    canvasRef.current.style.cursor='grabbing';
  };
  const handleUp=()=>{ dragRef.current.active=false; canvasRef.current.style.cursor='grab'; };
  const handleClick=(e)=>{
    const rect=canvasRef.current.getBoundingClientRect();
    const r=hit(e.clientX-rect.left,e.clientY-rect.top);
    if(r) onClick&&onClick(r);
    else onSelect&&onSelect(null);
  };

  const resetCamera=()=>{ camRef.current={x:WORLD_W/2,y:WORLD_H/2,zoom:0.32}; forceUpdate(n=>n+1); };
  const zoomIn = ()=>{ camRef.current.zoom=Math.min(5,camRef.current.zoom*1.3); forceUpdate(n=>n+1); };
  const zoomOut = ()=>{ camRef.current.zoom=Math.max(0.15,camRef.current.zoom/1.3); forceUpdate(n=>n+1); };

  return (
    <div className="canvas-wrap">
      <canvas ref={canvasRef} className="canvas"
        onMouseMove={handleMove} onMouseDown={handleDown} onMouseUp={handleUp}
        onMouseLeave={()=>{onHover&&onHover(null);dragRef.current.active=false;}} onClick={handleClick} />

      <div className="overlay-topright">
        <div className="cam">
          <button className="cam-btn" onClick={zoomIn} title="Zoom in">+</button>
          <div className="cam-zoom">{Math.round(camRef.current.zoom*100)}%</div>
          <button className="cam-btn" onClick={zoomOut} title="Zoom out">−</button>
          <div className="cam-sep" />
          <button className="cam-btn" onClick={resetCamera} title="Reset view" style={{fontSize:12}}>⊙</button>
        </div>
      </div>

      {showMinimap && <Minimap positions={positions} ravens={ravens} cam={camRef.current} size={sizeRef.current} onPan={(x,y)=>{ camRef.current.x=x; camRef.current.y=y; forceUpdate(n=>n+1); }} />}
    </div>
  );
}

function Minimap({ positions, ravens, cam, size, onPan }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d');
    const W = c.width = 220, H = c.height = 165;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = '#09090b'; ctx.fillRect(0,0,W,H);
    const sx = W/WORLD_W, sy = H/WORLD_H;
    // realms
    REALMS.forEach(z => {
      ctx.strokeStyle = 'rgba(147,197,253,0.25)'; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.arc(z.wx*sx, z.wy*sy, z.wr*sx, 0, Math.PI*2); ctx.stroke();
    });
    // nodes
    ravens.forEach(r => {
      const p = positions.get(r.id); if(!p) return;
      const col = r.activity && r.activity!=='idle' ? '#bae6fd' : '#71717a';
      ctx.fillStyle = col;
      ctx.fillRect(p.x*sx-0.5, p.y*sy-0.5, r.kind==='mimir'?3:1.5, r.kind==='mimir'?3:1.5);
    });
    // viewport
    if (size.w && cam.zoom) {
      const vw = size.w/cam.zoom, vh = size.h/cam.zoom;
      const vx = (cam.x - vw/2)*sx, vy = (cam.y - vh/2)*sy;
      ctx.strokeStyle = '#bae6fd'; ctx.lineWidth = 1;
      ctx.strokeRect(vx, vy, vw*sx, vh*sy);
    }
  }, [positions, ravens, cam.x, cam.y, cam.zoom, size.w, size.h]);

  const handleClick = (e) => {
    const rect = ref.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * WORLD_W;
    const y = (e.clientY - rect.top) / rect.height * WORLD_H;
    onPan(x,y);
  };

  return (
    <div className="overlay-bottomright">
      <div className="panel minimap-panel">
        <canvas ref={ref} className="minimap-canvas" style={{width:220,height:165, cursor:'crosshair'}} onClick={handleClick} />
        <div className="minimap-caption"><span>MINIMAP</span><span>{ravens.length} entities</span></div>
      </div>
    </div>
  );
}

window.FlokkObservatory = { Observatory, useMockFlokkState, REALMS, CLUSTERS, SUB_MIMIRS, seedEntities };
