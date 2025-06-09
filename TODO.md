# TODO

* advanced voice mode
* 有些时候生成到一半，会断开网络连接
* 如果正在Working，那么不要刷新页面
* 代码写得太差了找时间重新写
* 账号随机端口，但是如果上次的还能用，优先用上次的
* tab janitor 很重要


* Projects
  * 重命名Project和conversation
  * mapUserTokenToPendingNewConversation的处理
* 怎么第一次加载，会用错模型？要不sessionStorage里面，搞个refresh吧 - 或者插件控制warm up
* canvas - 切换账号之后会不工作
* “…”按钮 当中 添加导出当前会话等功能
* 更好的携带聊天记录转号的功能，直接使用GPT官方的share链接（现在share的会话已经可以“继续”）
* 去掉原版chatgpt的各种不方便的东西
  * 微信浏览器的Cloudflare
* first token 如果10秒还没出来，就退出然后自动刷新页面
  * 现在变成了该刷新的时候需要多刷新
* 优化搜索功能和归档功能
* 各种分页（cursor）功能实现
* canvas当中执行代码
* connecting卡住的话要backoff重连
* 网关模式, 动态路由优选
* 有时候会一直卡在Working，可能是请求没有正常结束的情况，比如网特别卡
* Worker disconnect unexpectedly之后，如果已经提交了生成请求，用户会没有这个会话的权限
* share功能
* https://web-sandbox.oaiusercontent.com/
* 解决各种 // TODO
* GPTs

---

# o3降智检测

```
solve the 24 problem with 2,3,5,12, output in the following format:

> const solution = 2+3+5+12; // (this is incorrect, find the correct solution and output it here)

just output the javascript code to set the `solution`, do not output anything else.
```

and no `a few seconds`