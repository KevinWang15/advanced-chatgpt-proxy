# BUGS



# TODO

* 去掉原版chatgpt的各种不方便的东西
  * 一直refresh account是在做什么(好像只有切换账号的时候会refresh)
  * 怎么同时开两个号的话会一直不停refresh
  * 微信浏览器的Cloudflare
* first token 如果10秒还没出来，就退出然后自动刷新页面
  * 现在变成了该刷新的时候需要多刷新
* 首次会话会卡住(纯粹是因为网卡) - 首次会话的时候会多一个...也是不太好看
* 代码写得太差了找时间重新写
* connecting卡住的话要backoff重连
* 网关模式, 动态路由优选
* 有时候会一直卡在Working，可能是请求没有正常结束的情况，比如网特别卡
* advanced voice mode
* Projects
* Worker disconnect unexpectedly之后，如果已经提交了生成请求，用户会没有这个会话的权限
* Invalid request, please copy your prompt, refresh the page, and send again - 还有优化空间吗
* 如果上一条是failed reasoning, 然后你发送了一条，然后你编辑了那条发送的，那搞不定
* 稳定性: 第一个消息失败，用户点击重试按钮，无法重试
* share功能
* deep research 的图片
* https://web-sandbox.oaiusercontent.com/
* 解决各种 // TODO
* 在canvas当中选中并且提问
* 是否有可能全部使用headless mode完成，例如docker一键部署？（能否正常生成、是否Chrome会被降速）

# 下半年
* Sora
* Operator
* GPTs

---

# o3降智检测

```
solve the 24 problem with 2,3,5,12, output in the following format:

> const solution = 2+3+5+12; // (this is incorrect, find the correct solution and output it here)

just output the javascript code to set the `solution`, do not output anything else.
```

and no `a few seconds`