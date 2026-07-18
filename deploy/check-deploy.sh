#!/bin/bash
# check-deploy.sh — 部署完整性检查
set -e

DEV_ROOT="${1:-${PI_DEV_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}}"
# 兼容传入 DEV 根目录或 Codebase 目录
if [ -d "$DEV_ROOT/Codebase/core" ]; then
  IMPL="$DEV_ROOT/Codebase/core"
elif [ -d "$DEV_ROOT/core" ]; then
  IMPL="$DEV_ROOT/core"
else
  IMPL="$DEV_ROOT"
fi
PAIMON_EXT="$HOME/.local/lib/paimon/extensions"
RUNTIME_DIST="$HOME/.local/lib/paimon/runtime/node_modules/@earendil-works/pi-coding-agent/dist"

R='\033[0m'
RED='\033[31m'
YLW='\033[33m'
GRN='\033[32m'

ERRORS=0

ok()   { echo -e "  ${GRN}OK${R}  $1"; }
warn() { echo -e "  ${YLW}WARN${R}  $1"; }
err()  { echo -e "  ${RED}ERROR${R}  $1"; ERRORS=1; }
info() { echo -e "  ${YLW}INFO${R}  $1"; }

# 1. runtime 存在
if [ -f "$RUNTIME_DIST/cli.js" ]; then
  ok "runtime"
else
  err "runtime not found at $RUNTIME_DIST"
fi

# 2. 扩展目录存在
for ext in paimon-code; do
  if [ -e "$PAIMON_EXT/$ext" ]; then
    ok "extension $ext"
  else
    err "extension $ext not found"
  fi
done

# 3. launcher 存在
if [ -x "$HOME/.local/bin/paimon" ]; then
  ok "launcher"
else
  err "launcher ~/.local/bin/paimon not found"
fi

# 4. RNA 已转录
if [ -f "$IMPL/individual.bio.gene/rna.json" ]; then
  ok "rna.json"
else
  err "rna.json not found — run make dev-install"
fi


# 6. 消息渲染器检查：所有 isDisplayedInTUI 消息类型必须有 registerMessageRenderer
MSG_TYPES_FILE="$IMPL/individual.bio.organs/cells.ribosome/backbone"
if [ -f "$MSG_TYPES_FILE" ]; then
  MISSING_RENDERERS=""
  while IFS= read -r line; do
    if echo "$line" | grep -q '"[a-z][^"]*":'; then
      TYPE=$(echo "$line" | grep -o '"[^"]*"' | head -1 | tr -d '"')
    fi
    if echo "$line" | grep -q 'isDisplayedInTUI: true' && [ -n "$TYPE" ]; then
      HAS_RENDERER=$(grep -r "registerMessageRenderer.*$TYPE" "$IMPL/" --include="*.ts" -l 2>/dev/null || echo "")
      if [ -z "$HAS_RENDERER" ]; then
        MISSING_RENDERERS="$MISSING_RENDERERS  $TYPE\n"
      fi
    fi
  done < "$MSG_TYPES_FILE"
  if [ -n "$MISSING_RENDERERS" ]; then
    info "message types with isDisplayedInTUI=true but no registerMessageRenderer:"
    echo -e "$MISSING_RENDERERS" | while read -r t; do [ -n "$t" ] && echo -e "       $YLW$t$R"; done
    info "(run: grep -r registerMessageRenderer to add renderers)"
  else
    ok "all displayed message types have renderers"
  fi
fi

# 7. 文档编号检查：序号连续、不重、不漏、INDEX 匹配
DOC_ROOT="$DEV_ROOT/Docs/Dev"
for doc_dir in "$DOC_ROOT/Issues/Top-Level" "$DOC_ROOT/Norms" "$DOC_ROOT/Lessons"; do
  [ ! -d "$doc_dir" ] && continue
  dir_tag=$(echo "$doc_dir" | sed 's|.*/Docs/Dev/||')
  # 提取文件序号
  nums=$(ls "$doc_dir" 2>/dev/null | sed -n 's/^\([0-9][0-9]*\)-.*/\1/p' | sort -n)
  if [ -z "$nums" ]; then continue; fi
  # gaps & duplicates
  prev=-1; gaps=""; dups=""
  for n in $nums; do
    nn=$((10#$n))
    if [ $nn -le $prev ]; then dups="$dups $n"; fi
    if [ $prev -ge 0 ] && [ $nn -le $prev ]; then :; elif [ $prev -ge 0 ] && [ $((nn - prev)) -gt 1 ]; then
      for g in $(seq $((prev+1)) $((nn-1))); do gaps="$gaps $g"; done
    fi
    prev=$nn
  done
  # INDEX 检查：提取 INDEX 中条目编号行（- [NNN] 或 [N] 格式），只匹配行首
  idx_file=$(ls "$doc_dir"/*.INDEX 2>/dev/null | head -1)
  if [ -n "$idx_file" ]; then
    idx_nums=$(grep -oE '^\s*-?\s*\[[0-9]+' "$idx_file" | grep -oE '[0-9]+' | sort -n | uniq)
    file_nums=$(echo "$nums" | tr '\n' ' ' | xargs)
    # 只检查 INDEX 里的每个条目号在文件中是否存在（允许 INDEX 有额外编号如 000）
    missing_from_files=""
    for inum in $idx_nums; do
      inum=$((10#$inum))
      found=0
      for fnum in $nums; do fnum=$((10#$fnum)); [ "$inum" -eq "$fnum" ] && found=1; done
      [ "$found" -eq 0 ] && missing_from_files="$missing_from_files $inum"
    done
    # 反向检查：文件中的每个编号是否在 INDEX 中
    missing_from_idx=""
    for fnum in $nums; do
      fnum=$((10#$fnum))
      found=0
      for inum in $idx_nums; do inum=$((10#$inum)); [ "$inum" -eq "$fnum" ] && found=1; done
      [ "$found" -eq 0 ] && missing_from_idx="$missing_from_idx $fnum"
    done
    if [ -n "$missing_from_files" ]; then err "$dir_tag INDEX 引用不存在的文件: $missing_from_files"; fi
    if [ -n "$missing_from_idx" ]; then err "$dir_tag 文件未收录进 INDEX: $missing_from_idx"; fi
  fi
  if [ -n "$gaps" ]; then err "$dir_tag 序号缺失: $gaps"; fi
  if [ -n "$dups" ]; then err "$dir_tag 序号重复: $dups"; fi
done

# 8. 命名规范检查：app 目录的主入口 .ts 文件名必须和目录名一致
MOBILE_DIR="$IMPL/technology.local.mobile"
NAMING_BAD=""
for tier in apps; do
  tier_dir="$MOBILE_DIR/$tier"
  [ ! -d "$tier_dir" ] && continue
  for app_dir in "$tier_dir"/*/; do
    [ ! -d "$app_dir" ] && continue
    dir_name=$(basename "$app_dir")
    [ "${dir_name:0:1}" = "." ] && continue
    [ "${dir_name:0:8}" = "@FUTURE." ] && continue
    expected="$dir_name.ts"
    if [ ! -f "$app_dir/$expected" ]; then
      actual=$(ls "$app_dir"/*.ts 2>/dev/null | head -1)
      if [ -n "$actual" ]; then
        NAMING_BAD="$NAMING_BAD  $tier/$dir_name/$(basename "$actual") (应为 $expected)\n"
      fi
    fi
  done
done
if [ -n "$NAMING_BAD" ]; then
  err "app 主文件命名不规范:"
  echo -e "$NAMING_BAD" | while read -r line; do [ -n "$line" ] && echo -e "       $RED$line$R"; done
else
  ok "app naming conventions"
fi

# 9. @FUTURE 路径不能出现在 package.json 或 tsconfig.json 的 imports/paths 中
FUTURE_IN_CONFIG=""
# package.json: 只检查 "#xxx" import 行
hits=$(grep -n '"#.*@FUTURE\.' "$IMPL/package.json" 2>/dev/null || true)
if [ -n "$hits" ]; then FUTURE_IN_CONFIG="$FUTURE_IN_CONFIG\n  package.json: $hits"; fi
# tsconfig.json: 只检查 "#xxx" paths 行
hits=$(grep -n '"#.*@FUTURE\.' "$IMPL/tsconfig.json" 2>/dev/null || true)
if [ -n "$hits" ]; then FUTURE_IN_CONFIG="$FUTURE_IN_CONFIG\n  tsconfig.json: $hits"; fi
if [ -n "$FUTURE_IN_CONFIG" ]; then
  err "@FUTURE 路径不能出现在 imports/paths 配置中:"
  echo -e "$FUTURE_IN_CONFIG" | while read -r line; do [ -n "$line" ] && echo -e "       $RED$line$R"; done
else
  ok "no @FUTURE in config"
fi

# 9b. 别名表同步：tsconfig paths 必须与 package.json imports 一致,且指向的文件存在
# (历史教训: metaconsciousness.ts / main.ts / mouth.ts 三次漂移都是双表手工同步导致)
ALIAS_BAD=$(node -e "
const fs=require('fs'),path=require('path');
const p=JSON.parse(fs.readFileSync('$IMPL/package.json','utf8')).imports||{};
const t=(JSON.parse(fs.readFileSync('$IMPL/tsconfig.json','utf8').replace(/^\s*\/\/.*$/gm,'')).compilerOptions||{}).paths||{};
const bad=[];
for(const [k,v] of Object.entries(p)){
  const tv=t[k]&&t[k][0];
  if(!tv)bad.push(k+': tsconfig 缺失');
  else if(tv!==v)bad.push(k+': pkg='+v+' ts='+tv);
  if(!fs.existsSync(path.join('$IMPL',v)))bad.push(k+': 文件不存在 '+v);
}
console.log(bad.join('\n'));
" 2>/dev/null)
if [ -n "$ALIAS_BAD" ]; then
  err "别名表漂移 (package.json imports vs tsconfig paths):"
  echo "$ALIAS_BAD" | while read -r line; do [ -n "$line" ] && echo -e "       $RED$line$R"; done
else
  ok "alias table in sync"
fi

# 9c. 回归测试（bun test：protobuf 编解码 / 农历节假日 / 组织生命周期）
if command -v bun >/dev/null 2>&1 || [ -x "$HOME/.bun/bin/bun" ]; then
  BUN_BIN=$(command -v bun || echo "$HOME/.bun/bin/bun")
  TEST_OUT=$("$BUN_BIN" test \
    "$IMPL/individual.bio.organs/ears.listen/listen-doubao_client.test.ts" \
    "$IMPL/technology.local.mobile/apps/calendar/calendar-lunar.test.ts" \
    "$IMPL/world.society/organization/organization.test.ts" 2>&1 | tail -3)
  if echo "$TEST_OUT" | grep -q " 0 fail"; then
    ok "bun test ($(echo "$TEST_OUT" | grep -oE '[0-9]+ pass' | head -1))"
  else
    err "回归测试失败:\n$TEST_OUT"
  fi
else
  warn "bun 不可用，跳过回归测试"
fi

# 10. 密钥泄漏检查：源码中不能出现疑似 API key/token 的硬编码值
# 排除: services.json(运行时配置), node_modules, .git, rna.json(生成文件)
SECRET_LEAKS=""
# 检查 JSON 文件中的疑似凭证字段（apiKey/token/access_key 等有 ≥16 位非空值）
leaks=$(grep -rn '"doubao_app_key"\|"doubao_access_key"\|"doubao_token"\|"doubao_appid"\|"apiKey"\|"access_key"' "$IMPL/" \
  --include="*.json" --include="*.ts" --include="*.js" --include="*.cjs" --include="*.py" \
  2>/dev/null \
  | grep -v node_modules | grep -v "services.json" | grep -v "rna.json" \
  | grep -vE '"(apiKey|access_key|doubao_app_key|doubao_access_key|doubao_token|doubao_appid)":\s*""' \
  | grep -E ':\s*"[A-Za-z0-9_-]{12,}"' \
  || true)
if [ -n "$leaks" ]; then
  SECRET_LEAKS="$leaks"
fi
if [ -n "$SECRET_LEAKS" ]; then
  err "源码中检测到疑似硬编码密钥（凭证应只在 ~/.paimon/config/services.json）:"
  echo "$SECRET_LEAKS" | while IFS= read -r line; do [ -n "$line" ] && echo -e "       $RED$line$R"; done
else
  ok "no hardcoded secrets"
fi

echo ""
if [ "$ERRORS" -eq 0 ]; then
  echo -e "  ${GRN}all checks passed${R}"
else
  echo -e "  ${YLW}some checks failed${R}"
  exit 1
fi
