#!/usr/bin/env bash
# Tripo v3 API helper. Writes <out>.req.json and <out>.task.json, downloads <out>.glb (+ preview).
#   tripo.sh gen  <image.png> <out> [face_limit]   image -> textured model
#   tripo.sh rig  <task_id>   <out>                biped rig of a generated model
#   tripo.sh anim <task_id>   <out> <preset>...    presets on a rigged model, e.g. preset:biped:walk
# TRIPO_CONF: curl config holding the Authorization header (default ~/.vibe/tripo_curl_key.conf).
# TRIPO_HOST: openapi.tripo3d.ai (international) or openapi.tripo3d.com, whichever the key belongs to.
set -euo pipefail
CONF="${TRIPO_CONF:-$HOME/.vibe/tripo_curl_key.conf}"
API="https://${TRIPO_HOST:-openapi.tripo3d.ai}/v3"
CMD="$1"; IN="$2"; OUT="$3"
js() { node -e "$1" "${@:2}"; }
ok() { js 'let r=JSON.parse(require("fs").readFileSync(0));if(r.code){console.error(JSON.stringify(r));process.exit(1)}console.log(r.data[process.argv[1]])' "$1"; }

case "$CMD" in
  gen)
    TOKEN=$(curl -s -K "$CONF" "$API/files" -F "file=@$IN" | ok file_token)
    URL="$API/generation/image-to-model"
    BODY=$(js 'console.log(JSON.stringify({input:process.argv[1],model:"v3.1-20260211",texture:true,pbr:false,face_limit:+process.argv[2],texture_quality:"standard"}))' "$TOKEN" "${4:-20000}") ;;
  rig)
    URL="$API/animations/rig"
    BODY=$(js 'console.log(JSON.stringify({input:process.argv[1],model:"v3.0-20260909",rig_type:"biped",spec:"tripo"}))' "$IN") ;;
  anim)
    URL="$API/animations/retarget"
    BODY=$(js 'console.log(JSON.stringify({input:process.argv[1],animations:process.argv.slice(2),out_format:"glb",bake_animation:true,animate_in_place:true}))' "$IN" "${@:4}") ;;
  *) echo "unknown command $CMD" >&2; exit 2 ;;
esac
echo "$BODY" > "$OUT.req.json"
ID=$(curl -s -K "$CONF" "$URL" -H 'Content-Type: application/json' -d "$BODY" | ok task_id)
echo "task $ID"
while :; do
  curl -s -K "$CONF" "$API/tasks/$ID" > "$OUT.task.json"
  ST=$(js 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).data.status)' "$OUT.task.json")
  case "$ST" in
    success) break ;;
    queued|running) sleep 10 ;;
    *) echo "status $ST" >&2; cat "$OUT.task.json" >&2; exit 1 ;;
  esac
done
# model_url / rendered_image_url, or model_urls (one per preset) for a retarget
js 'const o=JSON.parse(require("fs").readFileSync(process.argv[1])).data.output;
for(const[k,v]of Object.entries(o)){
  if(Array.isArray(v))v.forEach((u,i)=>console.log(k+"_"+i+" "+u));
  else if(typeof v=="string"&&v.startsWith("http"))console.log(k+" "+v)}' "$OUT.task.json" |
while read -r k u; do
  case "$k" in
    model_url) curl -s -o "$OUT.glb" "$u" ;;
    model_urls_*) curl -s -o "$OUT.${k#model_urls_}.glb" "$u" ;;
    rendered_image_url) curl -s -o "$OUT.rendered_image.webp" "$u" ;;
  esac
done
echo "done $ID"
