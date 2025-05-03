# TODO

* 聊天记录，聊天记录要能够帮用户存一份
  * delete_conversation_immediately_afterwards 相反的，要trigger get full conversation
  * network当中拦截这个请求，更新数据库
  * reverse proxy当中，list则直接返回列表
  * reverse proxy当中，get则判断号是否是同一个号，如果是则live获取，不是则返回缓存值
  * handle_conversation中，去掉not authorized，而是判断号是否一致，如果不一致，报错
* 限流
  * 每个账号添加quota，按照积分来
  * 积分每30分钟涨，每次请求扣除
  * 前端显示quota
* 网关模式, 动态路由优选
* 有时候会一直卡在Working，可能是请求没有正常结束的情况，比如网特别卡
* advanced voice mode
* Worker disconnect unexpectedly之后，如果已经提交了生成请求，用户会没有这个会话的权限
* Invalid request, please copy your prompt, refresh the page, and send again - 还有优化空间吗
* 如果上一条是failed reasoning, 然后你发送了一条，然后你编辑了那条发送的，那搞不定
* 稳定性: 第一个消息失败，用户点击重试按钮，无法重试
* share功能
* deep research 的图片
* https://web-sandbox.oaiusercontent.com/
* 解决各种 // TODO
* inpaint功能，修改图片
* 在canvas当中选中并且提问
* 代码质量优化
* 文档写好
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