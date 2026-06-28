# pi 命令 zsh 补全。安装位置:~/.pi/agent/pi-completion.zsh(由 install.sh 部署)。
# 在 ~/.zshrc 里:  source "$HOME/.pi/agent/pi-completion.zsh"
# 需要 compinit 已初始化(zsh 默认 autoload -Uz compinit; compinit)。
_pi_comp() {
  local plist="$HOME/.pi/memory/plist.json"
  [[ ! -f "$plist" ]] && return
  local IFS=$'\n'
  local -a active archived flags
  # 在列表里的人(pi <名字> 进入)= 非归档；已归档的人(--unarchive 恢复用)
  active=($(node -e "try{JSON.parse(require('fs').readFileSync('$plist','utf8')).filter(p=>!p.archived).forEach(p=>console.log(p.name))}catch(e){}" 2>/dev/null))
  archived=($(node -e "try{JSON.parse(require('fs').readFileSync('$plist','utf8')).filter(p=>p.archived).forEach(p=>console.log(p.name))}catch(e){}" 2>/dev/null))
  flags=(--sc --archive --unarchive --archived)
  # 按上一个词决定补什么:--unarchive 补已归档；--archive/--sc 补在列表里的人；否则补 人 + flags。
  case "${words[CURRENT-1]}" in
    --unarchive) compadd -a archived ;;
    --archive|--sc) compadd -a active ;;
    --archived) ;;  # 它不带参数
    *) compadd -a active; compadd -a flags ;;
  esac
}
compdef _pi_comp pi
