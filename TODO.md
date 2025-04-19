# TODO

* 稳定性 还需要 加强
  * 这是error情况，应该拒绝掉… 用户发消息→AI回消息→用户发第二条消息但是失败，用户点了retry，会触发


---


* 优化first load
* 多实例 -  maybe需要指纹浏览器
* 网关模式
  * 动态路由优选
* 把用户体系做做好
* quality of life
  * 登入之后得到Access token，这样就无需让用户再配置一个
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
* Projects
