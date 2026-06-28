source: rna.json

# rna — RNA 编译产物

## 职责
DNA 编译器（transpiler）的输出。RNA 是一份扁平的 JSON 清单，
每行一个 func：名称、源码路径、编译后的代码/索引。
kernel 按 RNA 清单加载所有 func。
