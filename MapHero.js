// MapHero.js — PERSISTENT live-updating MapLibre map. The map mounts ONCE and
// then receives live state updates (worker position, status, coverage) which it
// applies smoothly IN PLACE — markers move, the route redraws, the camera eases —
// so a job's whole lifecycle (finding → on the way → on site → complete) plays as
// ONE continuous frame with no rebuilds or hard cuts.
//
// Renders MapLibre GL JS in a WebView (works in Expo Snack — no native module).
// Tiles: MapTiler (free). The key below is a PUBLISHABLE key — safe in the client;
// restrict it by origin in the MapTiler dashboard.
//
// Props:
//   height, markers[{lat,lng,label,status,sub,workerLat,workerLng,workerName,assignedName,assignedStatus,requestId}]
//   me{lat,lng}, coverage{n,points[]}, demand[{lat,lng}], onWorkerTap(requestId)
import React, { useRef, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import MapPostSheet from './MapPostSheet';
import { C, E } from './theme';

const MAPTILER_KEY = 'YOUR_MAPTILER_KEY';
const STYLE_URL = 'https://api.maptiler.com/maps/streets-v2-dark/style.json?key=' + MAPTILER_KEY;
const SYDNEY = { lat: -33.8688, lng: 151.2093 };

// Brand colours, matched to theme.js so the map speaks the SAME colour language as the rest of the
// app (the map renders as injected HTML and can't import theme.js directly, so we mirror the token
// VALUES here — one source of truth, Constitution Law 10). Semantic language preserved:
//   BLUE  = client / in-transit / brand   (theme C.indigo #4636E8)
//   BLUE2 = worker dot / route core        (a lighter indigo, kept for the two-tone route/marker)
//   GREEN = worker accepted / arrived / success / complete (theme C.green #0E7A52)
//   RED   = finding-workers / demand        (theme C.red #B23A2E)
//   GREY  = getting-ready / neutral         (theme C.mute #78787F)
const MC = {
  blue:  '#4636E8',   // = C.indigo
  blue2: '#6B5CF0',   // lighter indigo for the two-tone route/worker dot (derived from C.indigo)
  green: '#0E7A52',   // = C.green
  red:   '#B23A2E',   // = C.red
  grey:  '#78787F',   // = C.mute
};

const STATUS_META = {
  getting_ready: { color: MC.grey,  label: 'Getting ready' },
  on_the_way:    { color: MC.blue,  label: 'On the way' },
  on_site:       { color: MC.green, label: 'On site' },
  waiting:       { color: MC.red,   label: 'Finding workers' },
  done:          { color: MC.green, label: 'Complete' },
};

// Rough Sydney land test — keep demand heat off the ocean. Excludes the sea to
// the east of the coastline (very approximate but stops red bleeding into water).
function onLand(lat, lng) {
  // east of ~151.28 below the harbour is largely ocean; crude but effective
  if (lng > 1.5129e2 + (lat < -33.85 ? 0.0 : 0.03)) return false;
  return true;
}

// The static shell — built ONCE. No dynamic job data baked in; everything comes
// through window.__apply() updates after load.
function shellHtml() {
  return '<!DOCTYPE html><html><head>'
+ '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>'
+ '<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet"/>'
+ '<style>'
+ 'html,body,#map{height:100%;margin:0;background:#0B0B12}'
+ '.maplibregl-ctrl-attrib{font-size:8px;opacity:.22}'
+ '.maplibregl-ctrl-bottom-right{bottom:1px;right:1px}'
+ '.maplibregl-ctrl-attrib-button{opacity:.28;transform:scale(.82)}'
+ '.maplibregl-ctrl-attrib.maplibregl-compact{min-height:20px;background:transparent}'
+ '.maplibregl-popup-content{background:#16161F;color:#fff;border-radius:12px;padding:11px 13px;font-family:-apple-system,system-ui,sans-serif;box-shadow:0 8px 26px rgba(0,0,0,.5)}'
+ '.maplibregl-popup-content b{display:block;font-size:14px;margin-bottom:2px;color:#fff}'
+ '.maplibregl-popup-content span{color:#A6A6B8;font-size:11.5px}'
+ '.maplibregl-popup-tip{border-top-color:#16161F!important;border-bottom-color:#16161F!important}'
+ '.maplibregl-ctrl-group{background:#16161F;border:none!important;box-shadow:0 4px 14px rgba(0,0,0,.4)}'
+ '.maplibregl-ctrl-group button+button{border-top:1px solid rgba(255,255,255,.08)}'
+ '.maplibregl-ctrl-zoom-in .maplibregl-ctrl-icon,.maplibregl-ctrl-zoom-out .maplibregl-ctrl-icon{filter:invert(1) brightness(1.6)}'
+ '.pin{width:26px;height:26px;position:relative;cursor:pointer;transition:transform .4s ease}'
+ '.pin .glow{position:absolute;top:50%;left:50%;width:26px;height:26px;transform:translate(-50%,-50%);border-radius:50%;filter:blur(6px);opacity:.9;transition:background .6s ease}'
+ '.pin .dot{position:absolute;top:50%;left:50%;width:15px;height:15px;transform:translate(-50%,-50%);border-radius:50%;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;transition:background .6s ease,width .4s ease,height .4s ease}'
+ '.pin.done .dot{width:19px;height:19px}'
+ '.pin .chk{color:#fff;font-size:12px;font-weight:900;line-height:1}'
+ '.pin .ring{position:absolute;top:50%;left:50%;width:15px;height:15px;transform:translate(-50%,-50%);border-radius:50%;animation:ping 1.9s ease-out infinite}'
+ '.pin.arrived .dot{animation:arrivebump .8s ease-out 1}'
+ '@keyframes arrivebump{0%{transform:translate(-50%,-50%) scale(1)}30%{transform:translate(-50%,-50%) scale(1.35)}100%{transform:translate(-50%,-50%) scale(1)}}'
+ '.pin.done .dot{animation:donebloom .9s ease-out 1}'
+ '@keyframes donebloom{0%{transform:translate(-50%,-50%) scale(.6);opacity:.3}60%{transform:translate(-50%,-50%) scale(1.2)}100%{transform:translate(-50%,-50%) scale(1);opacity:1}}'
+ '@keyframes ping{0%{transform:translate(-50%,-50%) scale(.7);opacity:.7}100%{transform:translate(-50%,-50%) scale(3.4);opacity:0}}'
+ '.you{width:16px;height:16px;border-radius:50%;background:'+MC.blue+';border:3px solid #fff;box-shadow:0 0 14px rgba(70,54,232,.9)}'
+ '.you-wrap{width:16px;height:16px;position:relative}'
+ '.you-wrap .halo{position:absolute;top:50%;left:50%;width:16px;height:16px;transform:translate(-50%,-50%);border-radius:50%;background:'+MC.blue+';animation:youpulse 2.2s infinite}'
+ '.worker{width:22px;height:22px;position:relative}'
+ '.worker .wdot{position:absolute;top:50%;left:50%;width:16px;height:16px;transform:translate(-50%,-50%);border-radius:50%;background:'+MC.blue2+';border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5)}'
+ '.worker .whalo{position:absolute;top:50%;left:50%;width:16px;height:16px;transform:translate(-50%,-50%);border-radius:50%;background:'+MC.blue2+';animation:youpulse 1.8s infinite}'
+ '@keyframes youpulse{0%{transform:translate(-50%,-50%) scale(1);opacity:.5}70%{transform:translate(-50%,-50%) scale(3);opacity:0}100%{opacity:0}}'
+ '.travbadge{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(to top,rgba(11,11,18,0.96),rgba(11,11,18,0.82));color:#fff;padding:11px 16px 13px;box-shadow:0 -6px 20px rgba(0,0,0,.4);text-align:center;z-index:5;font-family:-apple-system,system-ui,sans-serif;transition:opacity .4s ease;opacity:0}'
+ '.travbadge.show{opacity:1}'
+ '.travbadge .tb-name{font-size:14.5px;font-weight:800;letter-spacing:-.2px}'
+ '.travbadge .tb-meta{font-size:12px;color:#A6A6B8;margin-top:2px}'
+ '.travbadge.tb-green{background:linear-gradient(to top,rgba(9,45,33,0.97),rgba(11,40,30,0.85))}'
+ '.travbadge.tb-green .tb-meta{color:#8FE3C2}'
+ '.travbadge.tb-celebrate{animation:celebrate .6s ease-out 1}'
+ '@keyframes celebrate{0%{transform:translateY(10px)}60%{transform:translateY(-2px)}100%{transform:translateY(0)}}'
// --- transition drama: a moment that plays once when a job changes stage ---
+ '.moment{position:absolute;top:0;left:0;right:0;display:flex;justify-content:center;pointer-events:none;z-index:20}'
+ '.moment .card{margin-top:112px;background:#fff;color:#0B0B12;padding:13px 20px;border-radius:999px;font-family:-apple-system,system-ui,sans-serif;font-size:14.5px;font-weight:800;box-shadow:0 12px 34px rgba(0,0,0,.55);display:flex;align-items:center;gap:10px;transform:translateY(-14px) scale(.96);opacity:0;animation:momentIn .5s cubic-bezier(.2,.8,.2,1) forwards}'
+ '.moment .card.out{animation:momentOut .45s ease-in forwards}'
+ '.moment .dot{width:11px;height:11px;border-radius:50%;flex:0 0 auto}'
+ '@keyframes momentIn{0%{transform:translateY(-14px);opacity:0}100%{transform:translateY(0);opacity:1}}'
+ '@keyframes momentOut{0%{transform:translateY(0);opacity:1}100%{transform:translateY(-14px);opacity:0}}'
// a burst ring that blooms from a pin at a key transition
+ '.burst{position:absolute;width:20px;height:20px;border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:15;animation:burst 1.1s ease-out forwards}'
+ '@keyframes burst{0%{transform:translate(-50%,-50%) scale(.4);opacity:.85}100%{transform:translate(-50%,-50%) scale(6);opacity:0}}'
+ '</style></head><body><div id="map"></div>'
+ '<div class="travbadge" id="badge"></div>'
+ '<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"><\/script>'
+ '<script>'
+ 'var map=new maplibregl.Map({container:"map",style:"' + STYLE_URL + '",center:[' + SYDNEY.lng + ',' + SYDNEY.lat + '],zoom:10.5,attributionControl:false,dragRotate:false,pitchWithRotate:false,fadeDuration:450});'
+ 'map.addControl(new maplibregl.AttributionControl({compact:true}),"bottom-right");'
+ ''
+ 'map.touchZoomRotate.disableRotation();'
+ 'function EASE(t){return t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;}'
+ 'function distM(a,b){var R=6371000,t=Math.PI/180;var dLat=(b[1]-a[1])*t,dLng=(b[0]-a[0])*t,la1=a[1]*t,la2=b[1]*t;var x=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)*Math.sin(dLng/2);return 2*R*Math.asin(Math.sqrt(x));}'
+ 'function human(m){return m<1000?Math.round(m)+" m":(m/1000).toFixed(m<10000?1:0)+" km";}'
// live state kept on the JS side so updates diff against it
+ 'var S={ready:false,youMk:null,pins:{},worker:{mk:null,anim:null,pos:null},lineReady:false,covReady:false,lastFocusKey:"",userTouched:false,touchAt:0};'
+ 'map.on("dragstart",function(){S.userTouched=true;S.touchAt=Date.now();});'
+ 'map.on("zoomstart",function(e){if(e.originalEvent){S.userTouched=true;S.touchAt=Date.now();}});'
+ 'map.on("load",function(){'
+ 'map.addSource("measure",{type:"geojson",data:{type:"FeatureCollection",features:[]}});'
+ 'map.addLayer({id:"measure-line",type:"line",source:"measure",paint:{"line-color":"#FFFFFF","line-width":2,"line-opacity":.6,"line-dasharray":[2,2]}});'
+ 'map.addSource("jobline",{type:"geojson",data:{type:"FeatureCollection",features:[]}});'
+ 'map.addLayer({id:"jobline-glow",type:"line",source:"jobline",paint:{"line-color":"'+MC.blue+'","line-width":8,"line-opacity":.25,"line-blur":4}});'
+ 'map.addLayer({id:"jobline-core",type:"line",source:"jobline",paint:{"line-color":"'+MC.blue2+'","line-width":3,"line-opacity":.95}});'
+ 'map.addSource("coverage",{type:"geojson",data:{type:"FeatureCollection",features:[]}});'
+ 'map.addLayer({id:"coverage-heat",type:"heatmap",source:"coverage",paint:{"heatmap-color":["interpolate",["linear"],["heatmap-density"],0,"rgba(14,122,82,0)",0.3,"rgba(14,122,82,0.5)",0.6,"rgba(16,140,94,0.75)",1,"rgba(18,160,108,0.95)"],"heatmap-radius":52,"heatmap-opacity":0.8,"heatmap-intensity":1.05}});'
+ 'map.addSource("demand",{type:"geojson",data:{type:"FeatureCollection",features:[]}});'
+ 'map.addLayer({id:"demand-heat",type:"heatmap",source:"demand",paint:{"heatmap-color":["interpolate",["linear"],["heatmap-density"],0,"rgba(178,58,46,0)",0.3,"rgba(178,58,46,0.45)",0.6,"rgba(196,64,52,0.7)",1,"rgba(210,70,58,0.9)"],"heatmap-radius":55,"heatmap-opacity":0.72,"heatmap-intensity":1.1}});'
// breathing pulse for the heat layers
+ 'var bt0=Date.now();S.hasHeat=false;S.breatheLast=0;function breathe(ts){'
+ 'if(S.hasHeat&&(ts-S.breatheLast>60)){S.breatheLast=ts;var e=0.5+0.5*Math.sin((Date.now()-bt0)/1400);'
+ 'try{map.setPaintProperty("coverage-heat","heatmap-opacity",0.8*(0.72+0.28*e));}catch(_){}'
+ 'try{map.setPaintProperty("demand-heat","heatmap-opacity",0.72*(0.72+0.28*e));}catch(_){}}'
+ 'requestAnimationFrame(breathe);}requestAnimationFrame(breathe);'
+ 'S.ready=true;if(window.__pending){apply(window.__pending);window.__pending=null;}'
+ 'function __sendReady(){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({type:"map_ready"}));}'
+ '__sendReady();map.once("idle",__sendReady);'
+ '});'
// ---- element factories ----
+ 'function pinEl(p){var el=document.createElement("div");el.className="pin";setPinClass(el,p);'
+ 'el.addEventListener("click",function(){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({type:"worker_tap",requestId:p.requestId}));});return el;}'
+ 'function setPinClass(el,p){var meta=p._meta;el.className="pin"+(p.pulse?" pulse":"")+(p.status==="on_site"?" arrived":"")+(p.status==="done"?" done":"");'
+ 'var inner=(p.status==="done"?"<div class=\\"chk\\">\\u2713</div>":"");'
+ 'el.innerHTML="<div class=\\"glow\\" style=\\"background:"+meta.color+"\\"></div>"+((p.pulse||p.status==="on_site")?"<div class=\\"ring\\" style=\\"background:"+meta.color+"55\\"></div>":"")+"<div class=\\"dot\\" style=\\"background:"+meta.color+"\\">"+inner+"</div>";}'
// ---- the LIVE updater: diff state, move things, ease camera. NO rebuild. ----
+ 'function apply(st){if(!S.ready){window.__pending=st;return;}'
+ 'var META={getting_ready:{color:"'+MC.grey+'",label:"Getting ready"},on_the_way:{color:"'+MC.blue+'",label:"On the way"},on_site:{color:"'+MC.green+'",label:"On site"},waiting:{color:"'+MC.red+'",label:"Finding workers"},done:{color:"'+MC.green+'",label:"Complete"}};'
// you marker
+ 'if(st.me){var yl=[st.me.lng,st.me.lat];if(!S.youMk){var yEl=document.createElement("div");yEl.className="you-wrap";yEl.innerHTML="<div class=\\"halo\\"></div><div class=\\"you\\"></div>";S.youMk=new maplibregl.Marker({element:yEl,anchor:"center"}).setLngLat(yl).addTo(map);}else{S.youMk.setLngLat(yl);}}'
// job pins — add new, update existing, remove gone. Detect STAGE TRANSITIONS
// (accepted->en_route->on_site->complete) and play a one-time on-map moment.
+ 'var seen={};(st.markers||[]).forEach(function(p){p._meta=META[p.status]||META.waiting;seen[p.requestId]=1;'
+ 'var eff=(p.assignedStatus||p.status);'
+ 'var ex=S.pins[p.requestId];if(!ex){var el=pinEl(p);var mk=new maplibregl.Marker({element:el,anchor:"center"}).setLngLat([p.lng,p.lat]).addTo(map);S.pins[p.requestId]={mk:mk,el:el,status:p.status,eff:eff};'
// seed prior-eff without firing a moment on first sight (unless it is a fresh accept)
+ 'if(!S.seededMoments){S.pinEff=S.pinEff||{};S.pinEff[p.requestId]=eff;}else{maybeMoment(null,eff,p,st.mode);S.pinEff=S.pinEff||{};S.pinEff[p.requestId]=eff;}}'
+ 'else{if(ex.status!==p.status){setPinClass(ex.el,p);ex.status=p.status;}ex.mk.setLngLat([p.lng,p.lat]);'
+ 'var prev=(S.pinEff&&S.pinEff[p.requestId]);if(prev&&prev!==eff){maybeMoment(prev,eff,p,st.mode);}S.pinEff=S.pinEff||{};S.pinEff[p.requestId]=eff;}});'
+ 'S.seededMoments=true;'
+ 'Object.keys(S.pins).forEach(function(id){if(!seen[id]){S.pins[id].mk.remove();delete S.pins[id];}});'
// worker dot + route line — the moving part, animated smoothly between updates
// worker dot only while genuinely EN ROUTE — once on-site/complete, remove it so
// stale GPS can't leave a lingering blip beside the site pin.
+ 'var trav=(st.markers||[]).filter(function(p){var e=(p.assignedStatus||p.status);return p.workerLat!=null&&p.workerLng!=null&&e!=="on_site"&&e!=="complete"&&p.status!=="done"&&p.status!=="on_site";})[0];'
+ 'if(trav){var target=[trav.workerLng,trav.workerLat];'
+ 'if(!S.worker.mk){var wEl=document.createElement("div");wEl.className="worker";wEl.innerHTML="<div class=\\"whalo\\"></div><div class=\\"wdot\\"></div>";'
+ 'wEl.addEventListener("click",function(){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({type:"worker_tap",requestId:trav.requestId}));});'
+ 'S.worker.mk=new maplibregl.Marker({element:wEl,anchor:"center"}).setLngLat(target).addTo(map);S.worker.pos=target;}'
+ 'else{glide(S.worker,target);}'
+ 'map.getSource("jobline").setData({type:"FeatureCollection",features:[{type:"Feature",geometry:{type:"LineString",coordinates:[target,[trav.lng,trav.lat]]}}]});'
+ '}else{if(S.worker.mk){S.worker.mk.remove();S.worker.mk=null;S.worker.pos=null;}map.getSource("jobline").setData({type:"FeatureCollection",features:[]});}'
// coverage + demand heat (idle only; cleared when a job is active)
+ 'var covF=(st.coverage||[]).map(function(c){return {type:"Feature",geometry:{type:"Point",coordinates:[c.lng,c.lat]}};});'
+ 'var demF=(st.demand||[]).map(function(c){return {type:"Feature",geometry:{type:"Point",coordinates:[c.lng,c.lat]}};});'
+ 'map.getSource("coverage").setData({type:"FeatureCollection",features:covF});'
+ 'map.getSource("demand").setData({type:"FeatureCollection",features:demF});'
+ 'S.hasHeat=(covF.length>0||demF.length>0);'
// badge (docked bottom bar)
+ 'updateBadge(st,META,trav);'
// camera — ease to the story, but never fight the user right after they touch
+ 'focus(st,trav);'
+ '}'
// smooth glide of the worker marker between GPS updates
// --- transition moments: one tasteful beat per stage change ---
+ 'function momentFor(eff,mode,crew){var W=(mode==="work");'
+ 'if(eff==="committed"||eff==="accepted")return W?{t:"You accepted this job",c:"'+MC.green+'"}:{t:(crew?"Your crew is forming":"A worker accepted your job"),c:"'+MC.blue+'"};'
+ 'if(eff==="en_route")return W?{t:"You\\u2019re on the way",c:"'+MC.blue+'"}:{t:(crew?"Your crew is on the way":"Your worker is on the way"),c:"'+MC.blue+'"};'
+ 'if(eff==="on_site")return W?{t:"You\\u2019ve arrived on site",c:"'+MC.green+'"}:{t:(crew?"Your crew has arrived":"Your worker has arrived"),c:"'+MC.green+'"};'
+ 'if(eff==="complete")return W?{t:"Job complete \\u2014 nice work",c:"'+MC.green+'"}:{t:"Job complete \\u2014 ready to approve",c:"'+MC.green+'"};'
+ 'return null;}'
+ 'function maybeMoment(prev,eff,p,mode){var crew=(p&&p.crewSize&&p.crewSize>1);var m=momentFor(eff,mode,crew);if(!m)return;showMoment(m.t,m.c);'
// burst blooms from the site pin for the punchy transitions
+ 'if(eff==="on_site"||eff==="complete"){burstAt([p.lng,p.lat],m.c);}'
+ 'if(eff==="committed"||eff==="accepted"){burstAt([p.lng,p.lat],m.c);}}'
+ 'function showMoment(text,color){var host=document.getElementById("moment");if(!host){host=document.createElement("div");host.id="moment";host.className="moment";document.body.appendChild(host);}'
+ 'host.innerHTML="<div class=\\"card\\"><span class=\\"dot\\" style=\\"background:"+color+"\\"></span>"+text+"</div>";'
+ 'var card=host.querySelector(".card");'
+ 'clearTimeout(S.momentT);S.momentT=setTimeout(function(){if(card){card.className="card out";setTimeout(function(){if(host)host.innerHTML="";},450);}},2600);}'
+ 'function burstAt(lnglat,color){try{var pt=map.project(lnglat);var b=document.createElement("div");b.className="burst";b.style.left=pt.x+"px";b.style.top=pt.y+"px";b.style.background=color;document.body.appendChild(b);setTimeout(function(){if(b&&b.parentNode)b.parentNode.removeChild(b);},1200);}catch(e){}}'
+ 'function glide(w,target){if(w.anim)cancelAnimationFrame(w.anim);var from=w.pos||target;var t0=Date.now();var dur=1400;'
+ 'function step(){var p=Math.min(1,(Date.now()-t0)/dur);var e=EASE(p);var lng=from[0]+(target[0]-from[0])*e;var lat=from[1]+(target[1]-from[1])*e;w.mk.setLngLat([lng,lat]);w.pos=[lng,lat];if(p<1){w.anim=requestAnimationFrame(step);}else{w.pos=target;}}step();}'
// badge content by status
+ 'function updateBadge(st,META,trav){var badge=document.getElementById("badge");'
+ 'function rank(p){var s=p.assignedStatus||p.status;if(p.workerLat!=null||s==="en_route")return 5;if(s==="on_site")return 4;if(s==="complete"||p.status==="done")return 3;if(s==="committed"||s==="accepted"||p.status==="getting_ready"||p.assignedName)return 2;if(p.status==="waiting")return 1;return 0;}'
+ 'var hero=null;(st.markers||[]).forEach(function(p){if(!hero||rank(p)>rank(hero))hero=p;});'
+ 'if(!hero||rank(hero)===0){badge.className="travbadge";return;}'
+ 'var who=(hero.assignedName?hero.assignedName.split(" ")[0]:(hero.workerName?hero.workerName.split(" ")[0]:"Worker"));'
+ 'var isCrew=(hero.crewSize&&hero.crewSize>1);var crewLbl=hero.crewSummary||("Crew of "+hero.crewSize);'
+ 'var hs=hero.assignedStatus||hero.status;var name="",meta="",cls="travbadge show";var W=(st.mode==="work");'
+ 'if(hero.workerLat!=null||hs==="en_route"){if(trav){var dm=distM([trav.workerLng,trav.workerLat],[trav.lng,trav.lat]);var mins=Math.max(1,Math.round(dm/1000/30*60));name=W?"You\\u2019re on the way":(isCrew?crewLbl:who+" on the way");meta=human(dm)+" \\u00b7 ~"+mins+" min \\u00b7 tap for details";}else{name=W?"You\\u2019re on the way":(isCrew?crewLbl:who+" on the way");meta="Heading to site \\u00b7 tap for details";}}'
+ 'else if(hs==="on_site"){cls+=" tb-green";name=W?"You\\u2019re on site":(isCrew?crewLbl:who+" is on site");meta=W?"Complete the job when done \\u00b7 tap":"Working now \\u00b7 tap for details";}'
+ 'else if(hs==="complete"||hero.status==="done"){cls+=" tb-green tb-celebrate";name="\\u2713 Job complete";meta=W?"Nice work \\u00b7 payment on the way":(isCrew?crewLbl+" \\u00b7 ready to approve & pay":who+" finished \\u00b7 ready to approve & pay");}'
+ 'else if(hs==="committed"||hs==="accepted"||hero.status==="getting_ready"||hero.assignedName){name=W?"You\\u2019re assigned":(isCrew?crewLbl:who+" is getting ready");meta=W?"Start your journey when ready \\u00b7 tap":"Assigned \\u00b7 tap for details";}'
+ 'else if(hero.status==="waiting"){name=W?"Job available":"Finding workers\\u2026";meta=W?"Tap to accept":"Your job is live \\u00b7 tap for details";}'
+ 'badge.className=cls;badge.innerHTML="<div class=\\"tb-name\\">"+name+"</div><div class=\\"tb-meta\\">"+meta+"</div>";'
+ 'if(hero&&hero.requestId){badge.style.cursor="pointer";badge.style.pointerEvents="auto";badge.__rid=hero.requestId;if(!badge.__wired){badge.__wired=true;badge.addEventListener("click",function(){if(window.ReactNativeWebView&&badge.__rid)window.ReactNativeWebView.postMessage(JSON.stringify({type:"worker_tap",requestId:badge.__rid}));});}}else{badge.style.pointerEvents="none";}}'
// camera focus — ONE continuous frame. Locks to the active job and only eases
// gently; never hard-recenters between phases. Respects recent user gestures.
+ 'function focus(st,trav){'
+ 'if(S.userTouched&&(Date.now()-S.touchAt)<9000)return;'   // let the user look around
+ 'var pts=[];var key="";'
+ 'if(trav){pts.push([trav.workerLng,trav.workerLat]);pts.push([trav.lng,trav.lat]);key="trav"+trav.requestId;}'
+ 'else{var active=(st.markers||[]).filter(function(p){return p.assignedName||p.status!=="waiting";});'
+ 'if(active.length){active.forEach(function(p){pts.push([p.lng,p.lat]);});if(st.me)pts.push([st.me.lng,st.me.lat]);key="job"+active.map(function(p){return p.requestId;}).join(",");}'
+ 'else if((st.markers||[]).length){(st.markers).forEach(function(p){pts.push([p.lng,p.lat]);});if(st.me)pts.push([st.me.lng,st.me.lat]);key="wait";}'
+ 'else if(st.me){pts.push([st.me.lng,st.me.lat]);key="me";}}'
+ 'if(!pts.length)return;'
// only recompute camera when the STORY changes (key), not on every position tick —
// keeps it continuous instead of re-framing constantly
+ 'var moved=trav&&S.lastFocusKey===key;'
+ 'if(S.lastFocusKey===key&&!moved)return;'
+ 'S.lastFocusKey=key;'
+ 'if(pts.length===1){map.easeTo({center:pts[0],zoom:14,duration:1200,easing:EASE});return;}'
+ 'var b=new maplibregl.LngLatBounds();pts.forEach(function(p){b.extend(p);});'
+ 'map.fitBounds(b,{padding:{top:55,bottom:105,left:50,right:50},duration:1200,easing:EASE,maxZoom:15});'
+ '}'
// receive updates from React Native
+ 'window.__apply=function(json){try{apply(JSON.parse(json));}catch(e){}};'
+ '<\/script></body></html>';
}

function viewFor(markers, me) {
  var pts = (markers || []).slice();
  if (me) pts.push(me);
  if (pts.length === 0) return { center: SYDNEY, zoom: 10.5 };
  var lats = pts.map(function (p) { return p.lat; }), lngs = pts.map(function (p) { return p.lng; });
  return { center: { lat: (Math.min.apply(null, lats) + Math.max.apply(null, lats)) / 2, lng: (Math.min.apply(null, lngs) + Math.max.apply(null, lngs)) / 2 }, zoom: 12 };
}

export default function MapHero({ height = 300, markers = [], me = null, framed = true, onWorkerTap = null, dockedBottom = false, activeNow = null, coverage = null, demand = null, mode = 'hire', offline = false, hubJobs = null, onHubAction = null, onPostFromMap = null, commandSummary = null, primaryAction = null, chatBubble = null }) {
  const hasJobs = markers && markers.length > 0;
  const missingKey = MAPTILER_KEY === 'YOUR_MAPTILER_KEY';
  const [full, setFull] = React.useState(false);
  const webRef = useRef(null);
  const fullWebRef = useRef(null);
  const [detailJob, setDetailJob] = React.useState(null);  // job whose detail sheet is open over the map
  const [postSheetOpen, setPostSheetOpen] = React.useState(false);  // map-native posting flow
  const [mapReady, setMapReady] = React.useState(false);  // true once tiles have painted — hides load surface
  // safety net: never let the loading surface trap the user. If the ready signal
  // doesn't arrive (bad tile key, network), lift the surface anyway after 2.5s.
  React.useEffect(() => {
    if (mapReady) return;
    const t = setTimeout(() => setMapReady(true), 2500);
    return () => clearTimeout(t);
  }, [mapReady]);

  // The shell HTML is built ONCE and never changes — that's what makes the map persistent.
  const html = useMemo(() => shellHtml(), []);

  // demand constrained to land (no red in the water)
  const landDemand = useMemo(
    () => (demand || []).filter((d) => onLand(d.lat, d.lng)),
    [demand]
  );

  // push live state into the map(s) whenever anything changes — no rebuild
  const pushState = useCallback(() => {
    const state = JSON.stringify({
      markers: markers || [],
      me,
      mode,
      coverage: !hasJobs && coverage && coverage.points ? coverage.points : [],
      demand: !hasJobs ? landDemand : [],
    });
    const js = 'window.__apply && window.__apply(' + JSON.stringify(state) + '); true;';
    // only feed the VISIBLE map — when fullscreen is open the small map is hidden,
    // so pushing to it (and running its animations) is wasted work.
    if (full) { if (fullWebRef.current) fullWebRef.current.injectJavaScript(js); }
    else if (webRef.current) { webRef.current.injectJavaScript(js); }
  }, [markers, me, coverage, landDemand, hasJobs, full, mode]);

  React.useEffect(() => { pushState(); }, [pushState]);

  const handleMessage = useCallback((e) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'map_ready') { setMapReady(true); return; }
      if (msg.type === 'worker_tap' && onWorkerTap) { setFull(false); onWorkerTap(msg.requestId); }
    } catch (_) {}
  }, [onWorkerTap]);

  const overlays = (expanded) => (
    <>
      {/* mode identity — soft accent + label, so users always know Hire vs Work */}
      {!expanded && <View pointerEvents="none" style={[styles.modeTint, { borderColor: mode === 'work' ? 'rgba(14,122,82,0.28)' : 'rgba(70,54,232,0.26)' }]} />}
      {!expanded && mode === 'work' ? (
        <View pointerEvents="none" style={styles.modeLabelWrap}>
          <View style={[styles.modeLabel, { backgroundColor: 'rgba(16,61,46,0.9)' }]}>
            <View style={[styles.modeLabelDot, { backgroundColor: C.green }]} />
            <Text style={styles.modeLabelT}>WORK NEAR YOU</Text>
          </View>
        </View>
      ) : null}
      {!expanded && mode === 'hire' && coverage && coverage.n > 0 ? (
        <View pointerEvents="none" style={styles.modeLabelWrap}>
          <View style={[styles.modeLabel, { backgroundColor: 'rgba(30,26,80,0.9)' }]}>
            <View style={[styles.modeLabelDot, { backgroundColor: MC.blue2 }]} />
            <Text style={styles.modeLabelT}>{coverage.n} WORKER{coverage.n === 1 ? '' : 'S'} NEARBY</Text>
          </View>
        </View>
      ) : null}
      {expanded && (
        // COMMAND CENTRE — top context bar (calm instrument panel)
        <View pointerEvents="none" style={styles.cmdTopBar}>
          <View style={styles.cmdTopRow}>
            <View style={[styles.modeLabelDot, { backgroundColor: mode === 'work' ? C.green : MC.blue2 }]} />
            <Text style={styles.cmdMode}>{mode === 'work' ? 'WORK' : 'HIRE'}</Text>
            {commandSummary ? <Text style={styles.cmdSummary} numberOfLines={1}>{commandSummary}</Text> : null}
          </View>
        </View>
      )}
      {offline && (
        <View pointerEvents="none" style={styles.offlineOverlay}>
          <View style={styles.offlineChip}>
            <View style={styles.offlineDot} />
            <Text style={styles.offlineT}>You're offline · go online to see work</Text>
          </View>
        </View>
      )}
      {missingKey && (
        <View style={styles.keyOverlay} pointerEvents="none">
          <Text style={styles.keyT}>Add your MapTiler key in MapHero.js</Text>
        </View>
      )}
      {!hasJobs && !missingKey && (
        <View style={[styles.emptyOverlay, expanded && styles.emptyOverlayFull]} pointerEvents="none">
          {/* When EXPANDED, the cmdTopBar (HIRE/WORK + summary) is already showing at the top —
              so any chip here is a SECOND overlaid bar. Only show ambient chips when collapsed.
              In hire mode the modeLabel/commandSummary carry the count; work mode gets the worker chip. */}
          {expanded ? null
            : coverage && coverage.n > 0 && mode !== 'hire' ? (
            <View style={styles.ambientChip}><View style={styles.ambientDot} /><Text style={styles.ambientT}>{coverage.n} worker{coverage.n === 1 ? '' : 's'} available near you</Text></View>
          ) : activeNow != null && activeNow > 0 ? (
            <View style={styles.ambientChip}><View style={styles.ambientDot} /><Text style={styles.ambientT}>{activeNow} jobs live on SiteCall right now</Text></View>
          ) : (!coverage || coverage.n === 0) ? (
            <Text style={styles.emptyT}>Post a job and watch it come alive here</Text>
          ) : null}
        </View>
      )}
      <TouchableOpacity style={[styles.expandBtn, expanded && styles.expandBtnFull]} onPress={() => setFull(!expanded ? true : false)} activeOpacity={0.85}>
        <Text style={styles.expandBtnT}>{expanded ? '✕' : '⛶'}</Text>
      </TouchableOpacity>
    </>
  );

  return (
    <>
      <View style={[styles.wrap, framed && styles.framed, dockedBottom && styles.dockedBottom, { height }]}>
        <WebView
          ref={webRef}
          originWhitelist={['*']}
          source={{ html }}
          style={styles.web}
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
          onMessage={handleMessage}
          onLoadEnd={pushState}
          cacheEnabled
          androidLayerType="hardware"
        />
        {!mapReady && (
          <View style={styles.loadSurface} pointerEvents="none">
            <ActivityIndicator color={C.indigo} size="small" />
          </View>
        )}
        {overlays(false)}
      </View>

      <Modal visible={full} animationType="slide" onRequestClose={() => setFull(false)}>
        <View style={styles.fullHost}>
          <View style={styles.fullMap}>
            {full && (
              <WebView
                ref={fullWebRef}
                originWhitelist={['*']}
                source={{ html }}
                style={styles.web}
                scrollEnabled={false}
                showsVerticalScrollIndicator={false}
                onMessage={handleMessage}
                onLoadEnd={pushState}
              />
            )}
            {overlays(true)}
            {/* COMMAND CENTRE bottom panel — always present (calm instrument panel) */}
            {full && (
              <View style={styles.cmdPanel} pointerEvents="box-none">
                {/* primary action dock — the one thing that matters right now */}
                {primaryAction && (
                  <TouchableOpacity
                    style={[styles.cmdDock, { backgroundColor: primaryAction.tone === 'green' ? C.green : primaryAction.tone === 'ready' ? C.indigo : '#1C1C24' }]}
                    activeOpacity={0.9}
                    onPress={() => { if (primaryAction.mapPost) { setPostSheetOpen(true); return; } if (primaryAction.closesMap) setFull(false); primaryAction.fn && primaryAction.fn(); }}>
                    {primaryAction.icon ? <View style={styles.cmdDockIcon}><Text style={styles.cmdDockIconT}>{primaryAction.icon}</Text></View> : null}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cmdDockT}>{primaryAction.label}</Text>
                      {primaryAction.sub ? <Text style={styles.cmdDockSub}>{primaryAction.sub}</Text> : null}
                    </View>
                    {primaryAction.chevron !== false ? <Text style={styles.cmdDockChevron}>›</Text> : null}
                  </TouchableOpacity>
                )}
                {/* the tracked jobs list */}
                {hubJobs && hubJobs.length > 0 && (
                  <View style={styles.hubSheet} pointerEvents="box-none">
                    <View style={styles.hubHandle} />
                    <Text style={styles.hubTitle}>{mode === 'work' ? 'Your work' : 'Your jobs'}</Text>
                    <ScrollView style={{ maxHeight: 240 }} showsVerticalScrollIndicator={false}>
                      {hubJobs.map((j) => (
                        <TouchableOpacity key={j.id} style={styles.hubRow} activeOpacity={0.85}
                          onPress={() => { if (j.detail) setDetailJob(j); else { if (mode !== 'work') setFull(false); onHubAction && onHubAction(j); } }}>
                          <View style={[styles.hubDot, { backgroundColor: j.dotColor || '#8A8AA0' }]} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.hubRowTitle} numberOfLines={1}>{j.title}</Text>
                            <Text style={styles.hubRowSub} numberOfLines={1}>{j.sub}</Text>
                          </View>
                          {j.action ? <Text style={[styles.hubAction, { color: mode === 'work' ? C.green : C.indigo }]}>{j.action}</Text> : null}
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>
            )}
            {/* Chat is reached from the job detail sheet's "Message" action, so no
               floating bubble is needed cluttering the map. */}
            {/* MAP-NATIVE POSTING — post a job without leaving the command centre */}
            {full && (
              <MapPostSheet
                visible={postSheetOpen}
                myLoc={me}
                onClose={() => setPostSheetOpen(false)}
                onPosted={() => { setPostSheetOpen(false); if (onPostFromMap) onPostFromMap({ posted: true }); }}
              />
            )}
            {/* IN-CENTRE DETAIL SHEET — job info + actions rise over the map, never leave */}
            {full && detailJob && detailJob.detail && (
              <View style={styles.detailScrim} pointerEvents="box-none">
                <TouchableOpacity style={styles.detailBackdrop} activeOpacity={1} onPress={() => setDetailJob(null)} />
                <View style={styles.detailSheet}>
                  <View style={styles.hubHandle} />
                  <View style={styles.detailHead}>
                    <View style={[styles.hubDot, { backgroundColor: detailJob.dotColor || '#8A8AA0', width: 12, height: 12 }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.detailTitle} numberOfLines={1}>{detailJob.title}</Text>
                      <Text style={styles.detailSub} numberOfLines={1}>{detailJob.sub}</Text>
                    </View>
                  </View>
                  {(detailJob.detail.rows || []).map((r, i) => (
                    <View key={i} style={styles.detailRow}>
                      <Text style={styles.detailRowK}>{r.k}</Text>
                      <Text style={styles.detailRowV} numberOfLines={1}>{r.v}</Text>
                    </View>
                  ))}
                  <View style={styles.detailActions}>
                    {(detailJob.detail.actions || []).map((a, i) => (
                      <TouchableOpacity key={i}
                        style={[styles.detailBtn, a.tone === 'green' ? styles.detailBtnGreen : a.tone === 'danger' ? styles.detailBtnDanger : a.tone === 'ready' ? styles.detailBtnReady : styles.detailBtnGhost]}
                        activeOpacity={0.88}
                        onPress={() => { const closeAfter = a.closesMap; setDetailJob(null); if (closeAfter) setFull(false); a.fn && a.fn(); }}>
                        <Text style={[styles.detailBtnT, (a.tone === 'ghost' || !a.tone) && { color: '#C8C8D4' }, a.tone === 'danger' && { color: '#FF5A5F' }]}>{a.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', backgroundColor: '#0B0B12', overflow: 'hidden' },
  framed: { marginHorizontal: 20, marginTop: 12, borderRadius: 20, borderWidth: 2, borderColor: '#16161A' },
  dockedBottom: { marginTop: 12, marginHorizontal: 20, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomWidth: 0, marginBottom: 0, ...E.sm },
  web: { flex: 1, backgroundColor: '#0B0B12' },
  loadSurface: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#0B0B12', alignItems: 'center', justifyContent: 'center' },
  emptyOverlay: { position: 'absolute', top: 46, left: 0, right: 0, alignItems: 'center' },
  emptyOverlayFull: { top: 114 },   // in fullscreen, sit clear below the command bar (top:64) + notch
  emptyT: { color: '#fff', fontSize: 11, backgroundColor: 'rgba(11,11,18,0.85)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, overflow: 'hidden' },
  ambientChip: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(11,11,18,0.9)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  ambientDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.green },
  ambientT: { color: '#fff', fontSize: 12, fontWeight: '600' },
  keyOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(11,11,18,0.9)' },
  keyT: { color: '#fff', fontSize: 12, fontWeight: '600', textAlign: 'center', paddingHorizontal: 20 },
  expandBtn: { position: 'absolute', top: 10, right: 10, width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(22,22,26,0.88)', alignItems: 'center', justifyContent: 'center' },
  expandBtnFull: { top: 62 },
  expandBtnT: { color: '#fff', fontSize: 17, fontWeight: '700' },
  modeTint: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 1.5, borderRadius: 18 },
  modeLabelWrap: { position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center' },
  modeLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  modeLabelDot: { width: 6, height: 6, borderRadius: 3 },
  modeLabelT: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  cmdTopBar: { position: 'absolute', top: 64, left: 0, right: 0, alignItems: 'center' },
  cmdTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(11,11,18,0.88)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, maxWidth: '72%' },
  cmdMode: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  cmdSummary: { color: '#B8B8C8', fontSize: 12, fontWeight: '600', marginLeft: 2 },
  cmdPanel: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  cmdDock: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 34, paddingVertical: 15, paddingHorizontal: 18, borderRadius: 16, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
  cmdDockIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  cmdDockIconT: { color: '#fff', fontSize: 17, fontWeight: '700', marginTop: -1 },
  cmdDockT: { color: '#fff', fontSize: 15.5, fontWeight: '800', letterSpacing: -0.2 },
  cmdDockSub: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 1 },
  cmdDockChevron: { color: 'rgba(255,255,255,0.9)', fontSize: 24, fontWeight: '300', marginTop: -2 },
  detailScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' },
  detailBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
  detailSheet: { backgroundColor: '#141419', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, paddingBottom: 36, paddingHorizontal: 20, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 30, shadowOffset: { width: 0, height: -10 } },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 6, marginBottom: 14 },
  detailTitle: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  detailSub: { color: '#A6A6B8', fontSize: 13, marginTop: 2 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  detailRowK: { color: '#8A8A98', fontSize: 13, fontWeight: '600' },
  detailRowV: { color: '#EDEDF2', fontSize: 13.5, fontWeight: '600', flexShrink: 1, marginLeft: 16 },
  detailActions: { marginTop: 16, gap: 9 },
  detailBtn: { paddingVertical: 15, borderRadius: 14, alignItems: 'center' },
  detailBtnGreen: { backgroundColor: C.green },
  detailBtnReady: { backgroundColor: C.indigo },
  detailBtnDanger: { backgroundColor: 'rgba(255,90,95,0.14)' },
  detailBtnGhost: { backgroundColor: 'rgba(255,255,255,0.06)' },
  detailBtnT: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  chatBubble: { position: 'absolute', right: 14, bottom: 184, width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(20,20,26,0.86)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  chatBubbleInner: { alignItems: 'center', justifyContent: 'center' },
  chatBubbleIcon: { fontSize: 18 },
  chatBubbleDot: { position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#FF5A5F', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, borderWidth: 2, borderColor: '#0B0B12' },
  chatBubbleDotT: { color: '#fff', fontSize: 10, fontWeight: '800' },
  offlineOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(11,11,18,0.55)' },
  offlineChip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(22,22,31,0.95)', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999 },
  offlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#8A8A94' },
  offlineT: { color: '#fff', fontSize: 12.5, fontWeight: '600' },
  fullHost: { flex: 1, backgroundColor: '#0B0B12' },
  fullMap: { flex: 1, overflow: 'hidden' },
  hubSheet: { backgroundColor: 'rgba(16,16,22,0.97)', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 8, paddingBottom: 34, paddingHorizontal: 18, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 24, shadowOffset: { width: 0, height: -8 } },
  hubHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', alignSelf: 'center', marginBottom: 12 },
  hubTitle: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: -0.2, marginBottom: 10, marginLeft: 2 },
  hubRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)' },
  hubDot: { width: 10, height: 10, borderRadius: 5 },
  hubRowTitle: { color: '#fff', fontSize: 14.5, fontWeight: '700' },
  hubRowSub: { color: '#A6A6B8', fontSize: 12, marginTop: 2 },
  hubAction: { fontSize: 13, fontWeight: '800' },
  postFromMap: { position: 'absolute', top: 62, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: C.indigo, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 999, shadowColor: C.indigo, shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
  postFromMapPlus: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  postFromMapPlusT: { color: '#fff', fontSize: 15, fontWeight: '700', marginTop: -1 },
  postFromMapT: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
});
