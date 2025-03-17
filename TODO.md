# TODO

* 一键截图ChatGPT
* 如果上一条是failed reasoning, 然后你发送了一条，然后你编辑了那条发送的，那搞不定
* 稳定性 还需要 加强
* 稳定性: 有时好像是conversation消息发不到server，或者server不能通知到worker
* 稳定性: 第一个消息失败，用户点击重试按钮，无法重试
* deep research 的图片
* https://web-sandbox.oaiusercontent.com/
* answer in chat instead
* GPTs
* Projects
* chrome不在页面上被降速的问题 （可以用betterdisplay多开虚拟显示屏来解决）
* Sora
* Operator
* 解决各种 // TODO
* 有些时候还是会不稳定卡住
* worker count metrics & alert


# direct send

```javascript
    window.postMessage({
        source: 'PAGE_SCRIPT',
        type: 'EXECUTE_WORKER_TASK',
        taskId: `page-task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        task: {
            "type": "conversation",
            "action": "next",
            "question": "nevermind, 12/(3-5/2))=24",
            "preferred_message_id": "f12690dd-5a60-49f8-9495-3a02a4d1ab6e",
            "model": "o3-mini",
            "parent_message_id": "c5bc3306-6f08-4ea2-8192-c29c0a715903",
            "conversation_id": "67e668fd-e0b4-8004-bde2-87c7daff4689",
            "raw_payload": {
                "action": "next",
                "messages": [
                    {
                        "id": "f12690dd-5a60-49f8-9495-3a02a4d1ab6e",
                        "author": {
                            "role": "user"
                        },
                        "create_time": 1743154006.151,
                        "content": {
                            "content_type": "text",
                            "parts": [
                                "nevermind, 12/(3-5/2))=24"
                            ]
                        },
                        "metadata": {
                            "__internal": {
                                "search_settings": {}
                            }
                        }
                    }
                ],
                "conversation_id": "67e668fd-e0b4-8004-bde2-87c7daff4689",
                "parent_message_id": "c5bc3306-6f08-4ea2-8192-c29c0a715903",
                "model": "o3-mini",
                "timezone_offset_min": -480,
                "timezone": "Asia/Shanghai",
                "conversation_mode": {
                    "kind": "primary_assistant"
                },
                "system_hints": [],
                "supports_buffering": true,
                "supported_encodings": [
                    "v1"
                ],
                "force_use_search": false,
                "client_contextual_info": {
                    "is_dark_mode": true,
                    "time_since_loaded": 37,
                    "page_height": 992,
                    "page_width": 1728,
                    "pixel_ratio": 2,
                    "screen_height": 1117,
                    "screen_width": 1728
                },
                "paragen_cot_summary_display_override": "allow",
                "path_to_message": [
                    "54e0d58f-994e-42d7-99c9-31e61a143459",
                    "2fcc5c96-5a41-4e15-b62e-79524850119b",
                    "bbeda301-af4c-4a8e-a784-0d2424059cf8",
                    "b087eda7-b847-4f65-ad9e-287fc2328ed3",
                    "c86726bd-4ac8-414f-af8d-5d55d33e4b83",
                    "624ce081-6680-4963-a07b-8018114ed0ce",
                    "f12690dd-5a60-49f8-9495-3a02a4d1ab6e",
                    "placeholder-request-67e668fd-e0b4-8004-bde2-87c7daff4689-1"
                ]
            },
            "response": null
        }
    }, window.location.origin)
```
