# TODO

* advanced voice mode
* Projects
  * 跳转到正确的conversation网址
  * list
  * 详情页面现在无法做到只读

* “…”按钮 当中 添加导出当前会话等功能
* 去掉原版chatgpt的各种不方便的东西
  * 微信浏览器的Cloudflare
* first token 如果10秒还没出来，就退出然后自动刷新页面
  * 现在变成了该刷新的时候需要多刷新
* 优化搜索功能和归档功能
* 首次会话会卡住(纯粹是因为网卡) - 首次会话的时候会多一个...也是不太好看
* 代码写得太差了找时间重新写
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