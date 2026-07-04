The Responses API is ModelArk’s latest interface, combining efficient context management, concise I/O, and enhanced tool invocation with advanced agent capabilities—ideal for building intelligent assistants and automation applications.

Responses API delivers a flexible and extensible foundation for action\-driven application development, making it ideal for use cases such as intelligent assistants, automation systems, and more.

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">Responses API is currently not supported in the <code>eu-west-1</code> region.</div>


<span id="4fba28f6"></span>
## Key benefits

Compared with the Chat API, the Responses API offers several advantages in terms of functionality and efficiency:


* Concise input and output format: Inputs can be provided as either a string or an array. Outputs are returned as a Response object with a unique ID, which is stored by default.

* Efficient context management: Context storage is enabled by default, allowing automatic context handling in multi\-turn conversations. This eliminates the need for manual context maintenance and improves the overall interaction experience.

* Low\-cost context caching: Frequently used context can be cached to reduce repeated processing and loading overhead for each request, significantly lowering costs.

* Flexible tool invocation: Supports multiple tool invocation methods, such as cloud deployment MCP, improving development and integration efficiency.

* Strong extensibility: More built\-in tools will be supported in the future, providing developers with richer and more flexible capabilities for building intelligent applications.



|Capability ||Chat API |Responses API |
|---|---|---|---|
|Text generation ||<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/aba4522e4aab46318574c8c3e460d20b~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/aba4522e4aab46318574c8c3e460d20b~tplv-goo7wpa0wc-image.image) </span> |
|Visual understanding ||<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/aba4522e4aab46318574c8c3e460d20b~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/aba4522e4aab46318574c8c3e460d20b~tplv-goo7wpa0wc-image.image) </span> |
|Structured output ||<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/aba4522e4aab46318574c8c3e460d20b~tplv-goo7wpa0wc-image.image) </span><br><br>(Beta) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/aba4522e4aab46318574c8c3e460d20b~tplv-goo7wpa0wc-image.image) </span><br><br>(Beta) |
|Tool invocation |Function calling |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/aba4522e4aab46318574c8c3e460d20b~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/aba4522e4aab46318574c8c3e460d20b~tplv-goo7wpa0wc-image.image) </span> |
| |Cloud deployment MCP |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/96a134db51ea4e8d83b5c9dccff686c3~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/aba4522e4aab46318574c8c3e460d20b~tplv-goo7wpa0wc-image.image) </span> |
|Context caching ||<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/96a134db51ea4e8d83b5c9dccff686c3~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/aba4522e4aab46318574c8c3e460d20b~tplv-goo7wpa0wc-image.image) </span><br><br>> Supported by models released after 250615 |


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">The following capabilities are <strong>not supported</strong> by the Responses API:</div>



* <div data-tips="true" data-tips-type="tip">Use fine\-tuned models for online inference</div>


* <div data-tips="true" data-tips-type="tip">Switch model version of online inference endpoints</div>



<span id="efbd0e6e"></span>
## Model List

LLMs of version 250615 and later, unless otherwise specified, support the Responses API by default. For the list of available models, see [Text generation](https://docs.byteplus.com/en/docs/ModelArk/1330310#b318deb2).

<span id="624fb83a"></span>
## Input/Output differences

Chat API (`/chat/completions`) and Responses API (`/responses`) differ slightly in their input and output formats.


* **Input**: The Chat API requires a message array as input, while the Responses API accepts input in either string or array format.


Additionally, in the Responses API, you can use the `instructions` field to supplement system prompts for specific turns.


* **Output**: The Chat API returns a message, while the Responses API returns a response object containing its own ID.


The following examples demonstrate the differences in usage between the two APIs.

```Plain Text
|Chat API |Responses API |
|---|---|
|Input example |Input example | \
| | | \
|```Python |```Python | \
|import os |import os | \
|from byteplussdkarkruntime import Ark  |from byteplussdkarkruntime import Ark | \
| | | \
|client = Ark( |client = Ark( | \
|    base_url="https://ark.ap-southeast.bytepluses.com/api/v3",  |    base_url='https://ark.ap-southeast.bytepluses.com/api/v3', | \
|    api_key=os.getenv('ARK_API_KEY'),  |    api_key=os.getenv('ARK_API_KEY'), | \
|) |) | \
| | | \
|completion = client.chat.completions.create( |response = client.responses.create( | \
|    model = "seed-2-0-lite-260228", |    model="seed-2-0-lite-260228", | \
|    messages=[ |    input="Hello.", | \
|        {"role": "user", "content": "Hello."}, |) | \
|    ], | | \
|) |print(response) | \
|print(completion) |``` | \
|``` | |
|Output example |Output example | \
| | | \
|```JSON |```JSON | \
|{ |{ | \
|    "choices": [ |    "created_at": 1765193461, | \
|        { |    "id": "resp_0217651934613099e1bacc68b98f823c2af95ea68bff0aec36f83", | \
|            "finish_reason": "stop", |    "max_output_tokens": 32768, | \
|            "index": 0, |    "model": "seed-2-0-lite-260228", | \
|            "logprobs": null, |    "object": "response", | \
|            "message": { |    "output": [ | \
|                "content": "Hello! How can I assist you today? Whether you have a question you'd like answered, want to chat about something that's on your mind, or need help with a specific task, feel free to share—I'm here to help. 😊", |        { | \
|                "reasoning_content": "\nGot it, let's see. The user just said \"Hello.\" I need to respond in a friendly way. Since the system prompt mentions I'm an AI assistant who can answer questions, chat, and provide information, I should keep it open-ended to encourage them to share what they need help with. Maybe something like \"Hello! How can I assist you today? Whether you have a question, want to chat about something, or need help with a task, feel free to let me know.\" That sounds natural and covers the points from the system prompt.", |            "id": "rs_02176519346192100000000000000000000ffffac15322033925d", | \
|                "role": "assistant" |            "type": "reasoning", | \
|            } |            "summary": [ | \
|        } |                { | \
|    ], |                    "type": "summary_text", | \
|    "created": 1765193367, |                    "text": "\nGot it, let's see. The user said \"hello.\" First, I need to respond in a friendly way. Since the system prompt mentions being a helpful assistant, I should greet back and maybe invite them to ask whatever they need help with. Let me make it natural. Like, \"Hello! How can I assist you today?\" That's simple and open-ended. Yeah, that works." | \
|    "id": "0217651933631536335e3dfd75940b9979797202ce7ea2a894823", |                } | \
|    "model": "seed-2-0-lite-260228", |            ], | \
|    "service_tier": "default", |            "status": "completed" | \
|    "object": "chat.completion", |        }, | \
|    "usage": { |        { | \
|        "completion_tokens": 164, |            "type": "message", | \
|        "prompt_tokens": 35, |            "role": "assistant", | \
|        "total_tokens": 199, |            "content": [ | \
|        "prompt_tokens_details": { |                { | \
|            "cached_tokens": 0 |                    "type": "output_text", | \
|        }, |                    "text": "Hello! How can I assist you today? Whether you have a question, need help with a task, or just want to chat, feel free to let me know. 😊" | \
|        "completion_tokens_details": { |                } | \
|            "reasoning_tokens": 114 |            ], | \
|        } |            "status": "completed", | \
|    } |            "id": "msg_02176519346378200000000000000000000ffffac153220cfab51" | \
|``` |        } | \
| |    ], | \
| |    "service_tier": "default", | \
| |    "status": "completed", | \
| |    "usage": { | \
| |        "input_tokens": 35, | \
| |        "output_tokens": 118, | \
| |        "total_tokens": 153, | \
| |        "input_tokens_details": { | \
| |            "cached_tokens": 0 | \
| |        }, | \
| |        "output_tokens_details": { | \
| |            "reasoning_tokens": 82 | \
| |        } | \
| |    }, | \
| |    "caching": { | \
| |        "type": "disabled" | \
| |    }, | \
| |    "store": true, | \
| |    "expire_at": 1765452661 | \
| |} | \
| |``` |
```


<span id="bafcdcbe"></span>
## Advanced capability compatibility

<span id="1fe46699"></span>
### Multi\-turn conversation

In multi\-turn conversation scenarios, using the Responses API enables more efficient context management and avoids the need to manually maintain context.


* The Chat API is stateless \- for each request, historical information must be placed in **messages** and set using the **role** field to enable topic\-related continuous conversation. For details, see [Multi-turn dialogue](https://docs.byteplus.com/en/docs/ModelArk/1399009#f6222fec).

* The Responses API turns on storage functionality by default, making context management more convenient. By specifying the **previous_response_id**, you can reference the input and reply of the corresponding request to achieve an intelligent interactive experience. For details, see Context management.



<span aceTableMode="list" aceTableWidth="1,1"></span>
|Chat API |Responses API |
|---|---|
|```Python```<br>```import os```<br>```from byteplussdkarkruntime import Ark```<br>``````<br>```client = Ark(```<br>```    base_url="https://ark.ap-southeast.bytepluses.com/api/v3",```<br>```    api_key=os.getenv('ARK_API_KEY'),```<br>```)```<br>``````<br>```completion = client.chat.completions.create(```<br>```    #Replace with Model ID```<br>```    model = "seed-2-0-lite-260228",```<br>```    messages=[```<br>``````<br>```        {"role": "user", "content": "Hi, tell a joke."},```<br>``````<br>```        {"role": "assistant","content":"I squeezed facial cleanser onto my toothbrush by mistake and did not notice the weird taste until I finished brushing."},```<br>``````<br>```        {"role": "user", "content": "What's the punchline of this joke?"}```<br>```    ]```<br>```)```<br>```print(completion.choices[0].message.content)```<br> |```Python```<br>```import os```<br>```from byteplussdkarkruntime import Ark```<br>``````<br>```client = Ark(```<br>```    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',```<br>```    api_key=os.getenv('ARK_API_KEY'),```<br>```)```<br>``````<br>```# Create the first-round conversation request```<br>```response = client.responses.create(```<br>```    model="seed-2-0-lite-260228",```<br>``````<br>```    input=[{"role": "user", "content": "Hi, tell a joke."}],```<br>```)```<br>```print(response)```<br>``````<br>```# Create the second-round conversation request```<br>```second_response = client.responses.create(```<br>```    model="seed-2-0-lite-260228",```<br>```    previous_response_id=response.id,```<br>``````<br>```    input=[{"role": "user", "content": "What's the punchline of this joke?"}],```<br>```)```<br>```print(second_response)```<br> |


<span id="6907b390"></span>
### Structured output schema


* Chat API: **response_format**. For details, see [Structured output](https://docs.byteplus.com/en/docs/ModelArk/1568221).

* Responses API: **text.format**. For details, see Structured output.



<span aceTableMode="list" aceTableWidth="1,1"></span>
|Chat API |Responses API |
|---|---|
|```Python```<br>```import os```<br>```from byteplussdkarkruntime import Ark```<br>``````<br>```client = Ark(```<br>```    base_url="https://ark.ap-southeast.bytepluses.com/api/v3",```<br>```    api_key=os.getenv('ARK_API_KEY'),```<br>```)```<br>``````<br>```completion = client.chat.completions.create(```<br>```    model = "seed-2-0-lite-260228",```<br>```    messages=[```<br>``````<br>```        {"role": "user", "content": "What are the common cruciferous plants? Output in JSON format."}```<br>```    ],```<br>```    response_format={"type":"json_object"},```<br>```    thinking={"type": "disabled"}, # Disable thinking```<br>```)```<br>```print(completion.choices[0].message.content)```<br> |```Python```<br>```import os```<br>```from byteplussdkarkruntime import Ark```<br>``````<br>```client = Ark(```<br>```    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',```<br>```    api_key=os.getenv('ARK_API_KEY'),```<br>```)```<br>``````<br>```response = client.responses.create(```<br>```    model="seed-2-0-lite-260228",```<br>```    input=[```<br>``````<br>```        {"role": "user", "content": "What are the common cruciferous plants? Output in JSON format."}```<br>```    ],```<br>```    text={"format":{"type": "json_object"}},```<br>```    thinking={"type": "disabled"}, # Disable thinking```<br>```)```<br>```print(response)```<br> |


<span id="bf59f661"></span>
### Maximum output length


* Chat API: Use the **max_completion_tokens** parameter to control the model's maximum output length. For details, see [Set the maximum output length](https://docs.byteplus.com/en/docs/ModelArk/1449737#31ecc4d7).

* Responses API: Use the **max_output_tokens** parameter to control the model's maximum output length. For details, see [Adjusting reasoning length](https://docs.byteplus.com/en/docs/ModelArk/1956279#dc4c1547).



<span aceTableMode="list" aceTableWidth="1,1"></span>
|Chat API |Responses API |
|---|---|
|```Python```<br>```import os```<br>```from byteplussdkarkruntime import Ark```<br>``````<br>```client = Ark(```<br>```    base_url="https://ark.ap-southeast.bytepluses.com/api/v3",```<br>```    api_key=os.getenv('ARK_API_KEY'),```<br>```)```<br>``````<br>```completion = client.chat.completions.create(```<br>```    model = "seed-2-0-lite-260228",```<br>```    messages=[```<br>``````<br>``````<br>```        {"role": "system", "content": "You are an AI assistant"},```<br>```        {"role": "user", "content": "What are the common cruciferous plants?"},```<br>```    ],```<br>```    max_completion_tokens = 1024,```<br>```)```<br>```print(completion.choices[0].message.content)```<br> |```Python```<br>```import os```<br>```from byteplussdkarkruntime import Ark```<br>``````<br>```client = Ark(```<br>```    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',```<br>```    api_key=os.getenv('ARK_API_KEY'),```<br>```)```<br>``````<br>```response = client.responses.create(```<br>```    model="seed-2-0-lite-260228",```<br>```    input=[```<br>``````<br>``````<br>```        {"role": "system", "content": "You are an AI assistant"},```<br>```        {"role": "user", "content": "What are the common cruciferous plants?"},```<br>```    ],```<br>```    max_output_tokens = 1024,```<br>```)```<br>```print(response)```<br> |


<span id="4eebac97"></span>
### Context caching

Compared to Context API, the Responses API offers greater flexibility in cache manipulation, supporting usage and modification at the ID level. For details on both methods, see [Context caching overview](https://docs.byteplus.com/en/docs/ModelArk/1398933).


<span aceTableMode="list" aceTableWidth="1,1"></span>
|Context API |Responses API |
|---|---|
|```Python```<br>```import datetime```<br>```import os```<br>```from byteplussdkarkruntime import Ark```<br>``````<br>```client = Ark(```<br>```    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',```<br>```    api_key=os.environ.get("ARK_API_KEY"),```<br>```)```<br>``````<br>```response = client.context.create(```<br>```    model=<YOUR_ENDPOINT_ID>,```<br>```    mode="session",```<br>```    messages=[```<br>``````<br>```        {"role": "system", "content": "You are Li Lei."},```<br>```    ],```<br>```    ttl=datetime.timedelta(minutes=60),```<br>```)```<br>```print(response)```<br>``````<br>```print("----- chat round 1 -----")```<br>```first_response = client.context.completions.create(```<br>```    context_id=response.id,```<br>```    model=<YOUR_ENDPOINT_ID>,```<br>```    messages=[```<br>``````<br>```        {"role": "user", "content": "I am FangFang."},```<br>```    ]```<br>```)```<br>```print(first_response.choices[0].message.content)```<br>``````<br>```print("----- chat round 2  -----")```<br>```second_response = client.context.completions.create(```<br>```    context_id=response.id,```<br>```    model=<YOUR_ENDPOINT_ID>,```<br>```    messages=[```<br>``````<br>```        {"role": "user", "content": "Who are you, and who am I?"},```<br>```    ]```<br>```)```<br>```print(second_response.choices[0].message.content)```<br> |```Python```<br>```import os```<br>```from byteplussdkarkruntime import Ark```<br>``````<br>```client = Ark(```<br>```    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',```<br>```    api_key=os.getenv('ARK_API_KEY'),```<br>```)```<br>``````<br>```response = client.responses.create(```<br>```    model="seed-2-0-lite-260228",```<br>```    input=[```<br>``````<br>```        {"role": "system", "content": "You are Li Lei."},```<br>```    ],```<br>```    caching={"type": "enabled"},```<br>```    thinking={"type": "disabled"},```<br>```)```<br>```print(response.output[0].content[0].text)```<br>```print("----- chat round 1 -----")```<br>```first_response = client.responses.create(```<br>```    model="seed-2-0-lite-260228",```<br>```    previous_response_id=response.id,```<br>``````<br>```    input=[{"role": "user", "content": "I am FangFang."}],```<br>```    caching={"type": "enabled"},```<br>```    thinking={"type": "disabled"},```<br>```)```<br>```print(first_response.output[0].content[0].text)```<br>```print("----- chat round 2 -----")```<br>```second_response = client.responses.create(```<br>```    model="seed-2-0-lite-260228",```<br>```    previous_response_id=first_response.id,```<br>``````<br>```    input=[{"role": "user", "content": "Who are you, and who am I?"}],```<br>```    caching={"type": "enabled"},```<br>```    thinking={"type": "disabled"},```<br>```)```<br>```print(second_response.output[0].content[0].text)```<br> |


<span id="f15240f8"></span>
### Tool use

<span id="8566777c"></span>
#### Function calling

There are subtle differences between the Responses API and Chat API in defining functions. For details, see [Function calling](https://docs.byteplus.com/en/docs/ModelArk/1262342).


<span aceTableMode="list" aceTableWidth="1,1"></span>
|Chat API |Responses API |
|---|---|
|```JSON```<br>```[```<br>```    {```<br>```        "type": "function",```<br>```        "function": {```<br>```            "name": "get_weather",```<br>``````<br>```            "description": "Query weather (including temperature and weather conditions) based on the city name",```<br>```            "parameters": {```<br>```                "type": "object",```<br>```                "properties": {```<br>```                    "location": {```<br>```                        "type": "string",```<br>``````<br>```                        "description": "City name, e.g., Beijing, Shanghai (only domestic prefecture-level cities are supported)"```<br>```                    }```<br>```                },```<br>```                "required": [```<br>```                    "location"```<br>```                ]```<br>```            }```<br>```        }```<br>```    }```<br>```]```<br> |```JSON```<br>```[```<br>```    {```<br>```        "type": "function",```<br>```        "name": "get_weather",```<br>``````<br>```        "description": "Query weather (including temperature and weather conditions) based on the city name",```<br>```        "parameters": {```<br>```            "type": "object",```<br>```            "properties": {```<br>```                "location": {```<br>```                    "type": "string",```<br>``````<br>```                    "description": "City name, e.g., Beijing, Shanghai (only domestic prefecture-level cities are supported)"```<br>```                }```<br>```            },```<br>```            "required": [```<br>```                "location"```<br>```            ]```<br>```        }```<br>```    }```<br>```]```<br> |


<span id="c8793bd4"></span>
#### MCP

You can integrate MCP (Model Context Protocol) servers with Responses API. Chat API currently does not support MCP integration. For details, see [Cloud-deployed MCP / remote MCP](https://docs.byteplus.com/history/folder/folder-untitled-2/translation-archive-cloud-deployment-mcp/translation-archive-cloud-deployment-mcp-remote-mcp.md).

```Python
from byteplussdkarkruntime import Ark
import os
# Initialize the client and enable MCP
client = Ark(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=os.getenv('ARK_API_KEY')
)
# Send a basic MCP call request
response = client.responses.create(
    model="seed-2-0-lite-260228",
    tools=[
        {
            "type": "mcp",
            "server_label": "deepwiki",
            "server_url": "https://mcp.deepwiki.com/mcp",
            "require_approval": "never"
        }
    ],
    input=[
        {
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": "Check the documentation for the byteplus/ai-app-lab repository."
                }
            ]
        }
    ],
    extra_headers={"ark-beta-mcp": "true"},
    stream=True  # Stream results
)

# Print the streaming response results.
for chunk in response:
    if hasattr(chunk, 'delta'):
        print(chunk.delta, end="", flush=True)
```


<span id="62166811"></span>
## Migration notes

New models are currently supported on both the Chat API and the Responses API, so you do not need to worry about future maintenance issues.

We recommend gradually adopting the Responses API based on your needs. You can start by using it in specific scenarios such as tool invocation and context caching. Once usage is stable, you can fully replace the Chat API to achieve a smooth and seamless transition.



