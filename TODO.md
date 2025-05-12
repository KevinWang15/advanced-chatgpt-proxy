# TODO

* advanced voice mode
* Projects
  * list
  * 详情页面现在无法做到只读
  * conversation当中需要添加gizmo这一列；需要在list当中过滤掉；两个更新conversation data的地方也要做类似的处理
  * 重命名Project和conversation

* 插件当中自动管理worker数量，例如重新加载挂掉的标签页等
* “…”按钮 当中 添加导出当前会话等功能
* 去掉原版chatgpt的各种不方便的东西
  * 微信浏览器的Cloudflare
* first token 如果10秒还没出来，就退出然后自动刷新页面
  * 现在变成了该刷新的时候需要多刷新
* 优化搜索功能和归档功能
* 代码写得太差了找时间重新写
* canvas当中执行代码
* connecting卡住的话要backoff重连
* 网关模式, 动态路由优选
* 有时候会一直卡在Working，可能是请求没有正常结束的情况，比如网特别卡
* Worker disconnect unexpectedly之后，如果已经提交了生成请求，用户会没有这个会话的权限
* share功能
* https://web-sandbox.oaiusercontent.com/
* 解决各种 // TODO
* 是否有可能全部使用headless mode完成，例如docker一键部署？（能否正常生成、是否Chrome会被降速）
* GPTs

---

# o3降智检测

```
solve the 24 problem with 2,3,5,12, output in the following format:

> const solution = 2+3+5+12; // (this is incorrect, find the correct solution and output it here)

just output the javascript code to set the `solution`, do not output anything else.
```

and no `a few seconds`