The Responses API supports prefix caching and session caching. By caching commonly used context, you can reduce the overhead of repeatedly processing the same content in each request and lower costs (cached inputs are discounted). It is suitable for scenarios where the same content needs to be passed in multiple times, such as multi\-turn conversations or tool calls.


> * For what it is and how it works, see [Caching modes](https://docs.byteplus.com/en/docs/ModelArk/1398933#dc271b0a).

> * For the API structure and parameters, see [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request).

> * Some models support implicit cache when using the Responses API. For details, see [Implicit cache](https://docs.byteplus.com/en/docs/ModelArk/1398933#1dfad02a) and [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310).


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">If you're new to ModelArk, see <a href="https://docs.byteplus.com/en/docs/ModelArk/1399008">Quick start</a> to get up and running quickly.</div>


<span id="14293fd6"></span>
# Supported models

See [Context caching](https://docs.byteplus.com/en/docs/ModelArk/1330310#476e6f25).

<span id="f3aac1c0"></span>
# Prerequisites

Complete the following steps before use.

<span id="dd3b59ab"></span>
# Quick start


<Tabs>
<Tab zoneid="ctVoFOzEa3" title="Python">
<TabTitle>Python</TabTitle>

```Python
# encoding=utf-8
import os
from byteplussdkarkruntime import Ark

client = Ark(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=os.getenv('ARK_API_KEY'),
)
# Input must be equal to or exceed 256 tokens; otherwise, prefix cache cannot be created.
input_text = "You are a literary analysis assistant. Answer concisely and clearly. Here is an excerpt from The Gift of the Magi by O. Henry. <long excerpt>"
response = client.responses.create(
    model="seed-2-0-lite-260228",
    input=[
        {
            "role": "system",
            "content": input_text,
        }
    ],
    caching={"type": "enabled", "prefix": True}, 
    thinking={"type": "disabled"},
)
print(response.usage.model_dump_json())

second_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=response.id,
    input=[{"role": "user", "content": "Briefly summarize the story in 5 bullet points."}],
    caching={"type": "enabled"}, 
    thinking={"type": "disabled"},
)

print(second_response.output[0].content[0].text)
print(second_response.usage.model_dump_json())
```



</Tab>
<Tab zoneid="t4To2kThvH" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/responses"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        // Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
        os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    ctx := context.Background()
    prefix := true
    resp, err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model: "seed-2-0-lite-260228",
        Input: &responses.ResponsesInput{
            Union: &responses.ResponsesInput_ListValue{
                ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{{
                    Union: &responses.InputItem_EasyMessage{
                        EasyMessage: &responses.ItemEasyMessage{
                            Role:    responses.MessageRole_system,
                            Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "You are a literary analysis assistant. Answer concisely and clearly. Here is an excerpt from The Gift of the Magi by O. Henry. <long excerpt>"}},
                        },
                    },
                }}},
            },
        },
        Caching:  &responses.ResponsesCaching{Type: responses.CacheType_enabled.Enum(), Prefix: &prefix},
        Thinking: &responses.ResponsesThinking{Type: responses.ThinkingType_disabled.Enum()},
    })
    if err != nil {
        fmt.Printf("response error: %v", err)
        return
    }
    fmt.Println(resp.GetUsage())

    second_resp, second_err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model:              "seed-2-0-lite-260228",
        PreviousResponseId: &resp.Id,
        Input: &responses.ResponsesInput{
            Union: &responses.ResponsesInput_ListValue{
                ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{{
                    Union: &responses.InputItem_EasyMessage{
                        EasyMessage: &responses.ItemEasyMessage{
                            Role:    responses.MessageRole_user,
                            Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "Briefly summarize the story in 5 bullet points"}},
                        },
                    },
                }}},
            },
        },
        Thinking: &responses.ResponsesThinking{Type: responses.ThinkingType_disabled.Enum()},
    })
    if second_err != nil {
        fmt.Printf("second response error: %v", second_err)
        return
    }
    fmt.Println(second_resp.GetUsage())

}
```



</Tab>
<Tab zoneid="QdOLha2NQl" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;
import com.byteplus.ark.runtime.model.responses.item.ItemEasyMessage;
import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.model.responses.request.*;
import com.byteplus.ark.runtime.model.responses.response.ResponseObject;
import com.byteplus.ark.runtime.model.responses.constant.ResponsesConstants;
import com.byteplus.ark.runtime.model.responses.item.MessageContent;
import com.byteplus.ark.runtime.model.responses.response.DeleteResponseResponse;
import com.byteplus.ark.runtime.model.responses.common.ResponsesCaching;
import com.byteplus.ark.runtime.model.responses.common.ResponsesThinking;

public class demo {
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        // The base URL for model invocation
        ArkService arkService = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_SYSTEM).content(
                                MessageContent.builder().stringValue("You are a literary analysis assistant. Answer concisely and clearly. Here is an excerpt from The Gift of the Magi by O. Henry. <long excerpt>").build()
                        ).build()
                ).build())
                .caching(ResponsesCaching.builder().type("enabled").prefix(true).build())
                .thinking(ResponsesThinking.builder().type(ResponsesConstants.THINKING_TYPE_DISABLED).build())
                .build();
        ResponseObject resp = arkService.createResponse(request);
        System.out.println(resp);
        System.out.println(resp.getUsage());
        System.out.println("---------------------");
        CreateResponsesRequest request2 = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .previousResponseId(resp.getId())
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder().stringValue("summarize the key events in 5 short bullet points.").build()
                        ).build()
                ).build())
                .thinking(ResponsesThinking.builder().type(ResponsesConstants.THINKING_TYPE_DISABLED).build())
                .build();
        ResponseObject resp2 = arkService.createResponse(request2);
        System.out.println(resp2);
        System.out.println(resp2.getUsage());        
        arkService.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="Hs0HmjmJKp" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
# encoding=utf-8
import os
from openai import OpenAI

client = OpenAI(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=os.getenv('ARK_API_KEY'),
)
# Input must be equal to or exceed 256 tokens; otherwise, prefix caching cannot be created.
input_text = "You are a literary analysis assistant. Answer concisely and clearly. Here is an excerpt from The Gift of the Magi by O. Henry. <long excerpt>"
response = client.responses.create(
    model="seed-2-0-lite-260228",
    input=[
        {
            "role": "system",
            "content": input_text,
        }
    ],
    extra_body={"caching": {"type": "enabled", "prefix": True}, "thinking": {"type": "disabled"}},
)
print(response.usage.model_dump_json())

second_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=response.id,
    input=[{"role": "user", "content": "Briefly summarize the story in 5 bullet points."}],
    extra_body={"thinking": {"type": "disabled"}},
)

print(second_response.output[0].content[0].text)
print(second_response.usage.model_dump_json())
```



</Tab>
<Tab zoneid="uwS9kLFlnt" title="cURL">
<TabTitle>cURL</TabTitle>

1. Create a cache and write content to it.

> The cached content *must be at least 256 tokens, otherwise the prefix caching cannot be created.* 


```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
-H "Authorization: Bearer $ARK_API_KEY" \\
-H "Content-Type: application/json" \\
-d '{
    "model": "seed-2-0-lite-260228",
    "input": "You are a literary analysis assistant. Answer concisely and clearly. Here is an excerpt from The Gift of the Magi by O. Henry. <long excerpt>",
    "caching":{
        "type":"enabled", 
        "prefix": true
    },
    "thinking": {
        "type": "disabled"
    }
}'
```



2. In subsequent requests, read and use the cache through the ID.


```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
-H "Authorization: Bearer $ARK_API_KEY" \\
-H "Content-Type: application/json" \\
-d '{
    "model": "seed-2-0-lite-260228",
    "input": "Briefly summarize the story in 5 bullet points.",
    "caching":{
        "type":"enabled"
    },
    "thinking": {
        "type": "disabled"
    },
    "previous_response_id":"resp_0217****"
}'
```



</Tab>
</Tabs>


The returned `usage` information is as follows:

```JSON
{"input_tokens":2535,"input_tokens_details":{"cached_tokens":0},"output_tokens":0,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":2535,"tool_usage":null,"tool_usage_details":null}
{"input_tokens":2551,"input_tokens_details":{"cached_tokens":2535},"output_tokens":133,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":2684,"tool_usage":null,"tool_usage_details":null}
```


> In the long text example above, the second request has `"cached_tokens":2535`. Compared with requests that do not use caching, the cost of cached requests is reduced by 80%. For requests with ultra\-long input, such as ultra\-long text or ultra\-long historical conversations, the cost reduction will be even more significant.


<span id="1ec1fe26"></span>
# Prefix caching

You can pre\-store and cache initialization information such as roles and backgrounds. When calling the model later, you do not need to send this information to the model repeatedly. Instead, you can use the cached processed initialization information as cache input, to reduce redundant computation and storage overhead and lower usage costs. It is especially suitable for applications with repeated prompts or standardized opening text.

Note: For the first round of input, you need to set `"store": true` (default is `true`) and `"caching": {"type": "enabled", "prefix": true }` to create prefix caching. In subsequent rounds, you can reference the cached information through previous_response_id.

Restrictions for creating prefix caching: Input tokens must be greater than or equal to 256 tokens, otherwise an error will be reported; the stream parameter cannot be set to true.

> When creating prefix caching, total_tokens = input_tokens in the returned usage, and output_tokens is always 0.



<Tabs>
<Tab zoneid="Qs1Yx08D9V" title="Python">
<TabTitle>Python</TabTitle>

```Python
# coding=utf-8
import os
from byteplussdkarkruntime import Ark

client = Ark(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=os.getenv('ARK_API_KEY'),
)

response = client.responses.create(
    model="seed-2-0-lite-260228",
    input=[
            {
             "role": "system", 
             "content": "You are a literary analysis assistant. Answer concisely and clearly. Here is an excerpt from The Gift of the Magi by O. Henry. <long excerpt>" # Input must exceed 256 tokens; otherwise, prefix caching cannot be created.
            }
          ],
    caching={"type": "enabled", "prefix": True},
    thinking={"type": "disabled"},
)
print(response)

second_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=response.id,
    input=[{"role": "user", "content": "Write a diary entry from the point of view of Della describing her emotions before selling her hair."}],
    thinking={"type": "disabled"},
)
print(second_response)

third_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=response.id,
    input=[{"role": "user", "content": "Analyze how O. Henry uses irony in this part of the story. Provide a concise explanation."}],
    thinking={"type": "disabled"},
)
print(third_response)
```



</Tab>
<Tab zoneid="JQVlrVlnrj" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/responses"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        // Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
        os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    ctx := context.Background()
    prefix := true
    resp, err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model: "seed-2-0-lite-260228",
        Input: &responses.ResponsesInput{
            Union: &responses.ResponsesInput_ListValue{
                ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{{
                    Union: &responses.InputItem_EasyMessage{
                        EasyMessage: &responses.ItemEasyMessage{
                            Role:    responses.MessageRole_system,
                            Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "You are a literary analysis assistant. Answer concisely and clearly. Here is an excerpt from The Gift of the Magi by O. Henry. <long excerpt>"}},
                        },
                    },
                }}},
            },
        },
        Caching:  &responses.ResponsesCaching{Type: responses.CacheType_enabled.Enum(), Prefix: &prefix},
        Thinking: &responses.ResponsesThinking{Type: responses.ThinkingType_disabled.Enum()},
    })
    if err != nil {
        fmt.Printf("response error: %v", err)
        return
    }
    fmt.Println(resp)

    second_resp, second_err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model:              "seed-2-0-lite-260228",
        PreviousResponseId: &resp.Id,
        Input: &responses.ResponsesInput{
            Union: &responses.ResponsesInput_ListValue{
                ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{{
                    Union: &responses.InputItem_EasyMessage{
                        EasyMessage: &responses.ItemEasyMessage{
                            Role:    responses.MessageRole_user,
                            Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "Write a diary entry from the point of view of Della describing her emotions before selling her hair."}},
                        },
                    },
                }}},
            },
        },
        Thinking: &responses.ResponsesThinking{Type: responses.ThinkingType_disabled.Enum()},
    })
    if second_err != nil {
        fmt.Printf("second response error: %v", second_err)
        return
    }
    fmt.Println(second_resp)

    third_resp, third_err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model:              "seed-2-0-lite-260228",
        PreviousResponseId: &resp.Id,
        Input: &responses.ResponsesInput{
            Union: &responses.ResponsesInput_ListValue{
                ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{{
                    Union: &responses.InputItem_EasyMessage{
                        EasyMessage: &responses.ItemEasyMessage{
                            Role:    responses.MessageRole_user,
                            Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "Analyze how O. Henry uses irony in this part of the story. Provide a concise explanation."}},
                        },
                    },
                }}},
            },
        },
        Thinking: &responses.ResponsesThinking{Type: responses.ThinkingType_disabled.Enum()},
    })
    if third_err != nil {
        fmt.Printf("second response error: %v", third_err)
        return
    }
    fmt.Println(third_resp)
}
```



</Tab>
<Tab zoneid="rAQ9UWmF6H" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;
import com.byteplus.ark.runtime.model.responses.item.ItemEasyMessage;
import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.model.responses.request.*;
import com.byteplus.ark.runtime.model.responses.response.ResponseObject;
import com.byteplus.ark.runtime.model.responses.constant.ResponsesConstants;
import com.byteplus.ark.runtime.model.responses.item.MessageContent;
import com.byteplus.ark.runtime.model.responses.response.DeleteResponseResponse;
import com.byteplus.ark.runtime.model.responses.common.ResponsesCaching;
import com.byteplus.ark.runtime.model.responses.common.ResponsesThinking;

public class demo {
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        // The base URL for model invocation
        ArkService arkService = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_SYSTEM).content(
                                MessageContent.builder().stringValue("You are a literary analysis assistant. Answer concisely and clearly. Here is an excerpt from The Gift of the Magi by O. Henry. <long excerpt>").build()
                        ).build()
                ).build())
                .caching(ResponsesCaching.builder().type("enabled").prefix(true).build())
                .thinking(ResponsesThinking.builder().type(ResponsesConstants.THINKING_TYPE_DISABLED).build())
                .build();
        ResponseObject resp = arkService.createResponse(request);
        System.out.println(resp);
        System.out.println("---------------------");
        CreateResponsesRequest request2 = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .previousResponseId(resp.getId())
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder().stringValue("Write a diary entry from the point of view of Della describing her emotions before selling her hair.").build()
                        ).build()
                ).build())
                .thinking(ResponsesThinking.builder().type(ResponsesConstants.THINKING_TYPE_DISABLED).build())
                .build();
        ResponseObject resp2 = arkService.createResponse(request2);
        System.out.println(resp2);
        System.out.println("---------------------");
        CreateResponsesRequest request3 = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .previousResponseId(resp.getId())
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder().stringValue("Analyze how O. Henry uses irony in this part of the story. Provide a concise explanation.").build()
                        ).build()
                ).build())
                .thinking(ResponsesThinking.builder().type(ResponsesConstants.THINKING_TYPE_DISABLED).build())
                .build();
        ResponseObject resp3 = arkService.createResponse(request3);
        System.out.println(resp3);

        arkService.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="fsCO8l1E2h" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
# coding=utf-8
import os
from openai import OpenAI

client = OpenAI(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=os.getenv('ARK_API_KEY'),
)

response = client.responses.create(
    model="seed-2-0-lite-260228",
    input=[
            {
             "role": "system", 
             "content": "You are a literary analysis assistant. Answer concisely and clearly. Here is an excerpt from The Gift of the Magi by O. Henry. <long excerpt>" # It needs to exceed 256 tokens; otherwise, prefix caching cannot be created.
            }
    ],
    extra_body={
        "caching": {"type": "enabled", "prefix": True},
        "thinking":{"type":"disabled"}
    }
)
print(response)

second_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=response.id,
    input=[{"role": "user", "content": "Write a diary entry from the point of view of Della describing her emotions before selling her hair."}],
    extra_body={
        "thinking":{"type":"disabled"}
    }
)
print(second_response)

third_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=response.id,
    input=[{"role": "user", "content": "Analyze how O. Henry uses irony in this part of the story. Provide a concise explanation."}],
    extra_body={
        "thinking":{"type":"disabled"}
    }
)
print(third_response)
```



</Tab>
<Tab zoneid="iXiCw3oOry" title="cURL">
<TabTitle>cURL</TabTitle>

1. Create a cache and write content to it.


```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
-H "Authorization: Bearer $ARK_API_KEY" \\
-H "Content-Type: application/json;charset=utf-8" \\
-d '{
    "model": "seed-2-0-lite-260228",
    "input":[
                {
                 "role":"system", 
                 "content": "You are a literary analysis assistant. Answer concisely and clearly. Here is an excerpt from The Gift of the Magi by O. Henry. <long excerpt>" # Input must exceed 256 tokens; otherwise, prefix caching cannot be created.
                }
          ],
    "caching":{
        "type":"enabled",
        "prefix": true
    },
    "thinking": {
        "type": "disabled"
    }
}'
```



2. In the second round request, read and use the cache via the ID returned from the first round.


```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
-H "Authorization: Bearer $ARK_API_KEY" \\
-H "Content-Type: application/json" \\
-d '{
    "model": "seed-2-0-lite-260228",
    "input": "Write a diary entry from the point of view of Della describing her emotions before selling her hair.",
    "caching":{
        "type":"enabled"
    },
    "thinking": {
        "type": "disabled"
    },
    "previous_response_id":"<THE_ID_FROM_FIRST_CALL>"
}'
```



3. In the third round request, you also use the ID returned from the first round to read and use the cache.


```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
-H "Authorization: Bearer $ARK_API_KEY" \\
-H "Content-Type: application/json" \\
-d '{
    "model": "seed-2-0-lite-260228",
    "input": "Analyze how O. Henry uses irony in this part of the story. Provide a concise explanation.",
    "caching":{
        "type":"enabled"
    },
    "thinking": {
        "type": "disabled"
    },
    "previous_response_id":"<THE_ID_FROM_FIRST_CALL>"
}'
```



</Tab>
</Tabs>


<span id="3e69e743"></span>
# Session caching

The Responses API supports automatically storing historical conversation context and maintaining the cache. You can use cached input and reduce inference costs in scenarios such as multi\-turn conversations by calling previous_response_id.


<Tabs>
<Tab zoneid="bdOVdtJDfN" title="Python">
<TabTitle>Python</TabTitle>

```Python
# encoding=utf-8
import os
from byteplussdkarkruntime import Ark

client = Ark(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=os.getenv('ARK_API_KEY'),
)
input_text = "You are a literary analysis assistant. Answer concisely and clearly. Here is an excerpt from The Gift of the Magi by O. Henry. <long excerpt>"
response = client.responses.create(
    model="seed-2-0-lite-260228",
    input=[
        {
            "role": "system", 
            "content": input_text
        },
        {
            "role": "user",
            "content":"Briefly summarize the story in 5 bullet points."
        }
    ],
    caching={"type": "enabled"},
    thinking={"type": "disabled"},
)
print(response)
print(response.usage.model_dump_json())

# Enter cached information in subsequent requests
second_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=response.id,
    input=[{"role": "user", "content": "Write a diary entry from the point of view of Della describing her emotions before selling her hair."}],
    caching={"type": "enabled"},
    thinking={"type": "disabled"},
)

print(second_response)
print(second_response.usage.model_dump_json())

third_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=second_response.id,
    input=[{"role": "user", "content": "Based on the original excerpt and the diary Della just wrote, imagine how Jame would feel when he read the diary entry."}],
    caching={"type": "enabled"},
    thinking={"type": "disabled"},
)
print(third_response)
print(third_response.usage.model_dump_json())
```



</Tab>
<Tab zoneid="PzCs0UAVdH" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/responses"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        // Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
        os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    ctx := context.Background()

    input := "You are a literary analysis assistant. Answer concisely and clearly. Here is an excerpt from The Gift of the Magi by O. Henry. <long excerpt>"
    resp, err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model: "seed-2-0-lite-260228",
        Input: &responses.ResponsesInput{
            Union: &responses.ResponsesInput_ListValue{
                ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{
                    {
                        Union: &responses.InputItem_EasyMessage{
                            EasyMessage: &responses.ItemEasyMessage{
                                Role:    responses.MessageRole_system,
                                Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: input}},
                            },
                        },
                    },
                    {
                        Union: &responses.InputItem_EasyMessage{
                            EasyMessage: &responses.ItemEasyMessage{
                                Role:    responses.MessageRole_user,
                                Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "Briefly summarize the story in 5 bullet points."}},
                            },
                        },
                    },
                }},
            },
        },
        Caching:  &responses.ResponsesCaching{Type: responses.CacheType_enabled.Enum()},
        Thinking: &responses.ResponsesThinking{Type: responses.ThinkingType_disabled.Enum()},
    })
    if err != nil {
        fmt.Printf("response error: %v", err)
        return
    }
    fmt.Println(resp)
    fmt.Println(resp.GetUsage())

    second_resp, second_err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model:              "seed-2-0-lite-260228",
        PreviousResponseId: &resp.Id,
        Input: &responses.ResponsesInput{
            Union: &responses.ResponsesInput_ListValue{
                ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{{
                    Union: &responses.InputItem_EasyMessage{
                        EasyMessage: &responses.ItemEasyMessage{
                            Role:    responses.MessageRole_user,
                            Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "Write a diary entry from the point of view of Della describing her emotions before selling her hair."}},
                        },
                    },
                }}},
            },
        },
        Thinking: &responses.ResponsesThinking{Type: responses.ThinkingType_disabled.Enum()},
    })
    if second_err != nil {
        fmt.Printf("second response error: %v", second_err)
        return
    }
    fmt.Println(second_resp)
    fmt.Println(second_resp.GetUsage())
    third_resp, third_err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model:              "seed-2-0-lite-260228",
        PreviousResponseId: &second_resp.Id,
        Input: &responses.ResponsesInput{
            Union: &responses.ResponsesInput_ListValue{
                ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{{
                    Union: &responses.InputItem_EasyMessage{
                        EasyMessage: &responses.ItemEasyMessage{
                            Role:    responses.MessageRole_user,
                            Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "Based on the original excerpt and the diary Della just wrote, imagine how Jame would feel when he read the diary entry."}},
                        },
                    },
                }}},
            },
        },
        Thinking: &responses.ResponsesThinking{Type: responses.ThinkingType_disabled.Enum()},
    })
    if third_err != nil {
        fmt.Printf("third response error: %v", third_err)
        return
    }
    fmt.Println(third_resp)
    fmt.Println(third_resp.GetUsage())
}
```



</Tab>
<Tab zoneid="fqauVgYrCk" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;
import com.byteplus.ark.runtime.model.responses.item.ItemEasyMessage;
import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.model.responses.request.*;
import com.byteplus.ark.runtime.model.responses.response.ResponseObject;
import com.byteplus.ark.runtime.model.responses.constant.ResponsesConstants;
import com.byteplus.ark.runtime.model.responses.item.MessageContent;
import com.byteplus.ark.runtime.model.responses.common.ResponsesCaching;
import com.byteplus.ark.runtime.model.responses.common.ResponsesThinking;

public class demo {
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        // The base URL for model invocation
        ArkService arkService = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();
        String input = "You are a literary analysis assistant. Answer concisely and clearly. Here is an excerpt from The Gift of the Magi by O. Henry. <long excerpt>";
        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .input(ResponsesInput.builder()
                        .addListItem(ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_SYSTEM).content(
                                MessageContent.builder().stringValue(input).build()
                        ).build())
                        .addListItem(ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder().stringValue("Briefly summarize the story in 5 bullet points.").build()
                        ).build())
                        .build())
                .caching(ResponsesCaching.builder().type("enabled").build())
                .thinking(ResponsesThinking.builder().type(ResponsesConstants.THINKING_TYPE_DISABLED).build())
                .build();
        ResponseObject resp = arkService.createResponse(request);
        System.out.println(resp);
        System.out.println(resp.getUsage());
        System.out.println("---------------------");
        CreateResponsesRequest request2 = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .previousResponseId(resp.getId())
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder().stringValue("Write a diary entry from the point of view of Della describing her emotions before selling her hair.").build()
                        ).build()
                ).build())
                .thinking(ResponsesThinking.builder().type(ResponsesConstants.THINKING_TYPE_DISABLED).build())
                .build();
        ResponseObject resp2 = arkService.createResponse(request2);
        System.out.println(resp2.getOutput());
        System.out.println(resp2.getUsage());
        System.out.println("---------------------");
        CreateResponsesRequest request3 = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .previousResponseId(resp2.getId())
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder().stringValue("Based on the original excerpt and the diary Della just wrote, imagine how Jame would feel when he read the diary entry.").build()
                        ).build()
                ).build())
                .thinking(ResponsesThinking.builder().type(ResponsesConstants.THINKING_TYPE_DISABLED).build())
                .build();
        ResponseObject resp3 = arkService.createResponse(request3);
        System.out.println(resp3.getOutput());
        System.out.println(resp3.getUsage());

        arkService.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="csUjpDFVpP" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
import os
from openai import OpenAI

client = OpenAI(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=os.getenv('ARK_API_KEY'),
)

input_text = "You are a literary analysis assistant. Answer concisely and clearly. Here is an excerpt from The Gift of the Magi by O. Henry. <long excerpt>"
response = client.responses.create(
    model="seed-2-0-lite-260228",
    input=[
            {
                "role": "system", 
                "content": input_text
            },
            {
                "role": "user",
                "content":"Briefly summarize the story in 5 bullet points."
            }
          ],
    extra_body={
        "caching": {"type": "enabled"},
        "thinking":{"type":"disabled"}
    }
)
print(response)

second_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=response.id,
    input=[{"role": "user", "content": "Write a diary entry from the point of view of Della describing her emotions before selling her hair."}],
    extra_body={
        "caching": {"type": "enabled"},
        "thinking":{"type":"disabled"}
    }
)
print(second_response)

third_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=second_response.id,
    input=[{"role": "user", "content": "Based on the original excerpt and the diary Della just wrote, imagine how Jame would feel when he read the diary entry."}],
    extra_body={
        "caching": {"type": "enabled"},
        "thinking":{"type":"disabled"}
    }
)
print(third_response)
```



</Tab>
<Tab zoneid="wIeqgL0Sa8" title="cURL">
<TabTitle>cURL</TabTitle>

1. Create a cache and write content to it.


```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "seed-2-0-lite-260228",
    "input":[
                {
                 "role":"system", 
                 "content":"You are a literary analysis assistant. Answer concisely and clearly. Here is an excerpt from The Gift of the Magi by O. Henry. <long excerpt>"
                },
                {
                 "role": "user",
                 "content":"Briefly summarize the story in 5 bullet points."
                }
          ],
    "caching":{
        "type":"enabled"
    },
    "thinking": {
        "type": "disabled"
    }
}'
```



2. In the second round request, read and use the cache via the ID returned from the first round.

> If you need to update the cache, configure "caching":{"type":"enabled" } and use the ID of the returned request.


```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
-H "Authorization: Bearer $ARK_API_KEY" \\
-H "Content-Type: application/json" \\
-d '{
    "model": "seed-2-0-lite-260228",
    "input": "Write a diary entry from the point of view of Della describing her emotions before selling her hair.",
    "caching":{
        "type":"enabled"
    },
    "thinking": {
        "type": "disabled"
    },
    "previous_response_id": "<THE_ID_FROM_FIRST_CALL>"
}'
```



3. In the third round request, read and use the cache via the ID returned from the second round.


```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
-H "Authorization: Bearer $ARK_API_KEY" \\
-H "Content-Type: application/json" \\
-d '{
    "model": "seed-2-0-lite-260228",
    "input": "Based on the original excerpt and the diary Della just wrote, imagine how Jame would feel when he read the diary entry.",
    "caching":{
        "type":"enabled"
    },
    "thinking": {
        "type": "disabled"
    },
    "previous_response_id": "<THE_ID_FROM_SECOND_CALL>"
}'
```



</Tab>
</Tabs>


<span id="0387e087"></span>
# Control storage/cache lifecycle

You can specify the expiration time for context storage (**store**) and context cache (**caching**) via the **expire_at** parameter. The current maximum storage duration is 7 days, which is the current UTC UNIX timestamp plus 604800.

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">Note</div>


<div data-tips="true" data-tips-type="warning">Unlike the Context API which specifies <strong>ttl</strong> (Time to Live, the duration for which the corresponding information is stored on ModelArk), the Responses API specifies the expiration time for storage and cache. The specific differences are as follows:</div>



* <div data-tips="true" data-tips-type="warning">Context API: Specifies the storage duration of the cache via <strong>ttl</strong>. When <code>current time - last time the cache was accessed</code> is greater than the <strong>ttl</strong> value, the storage expires. The cache retention duration is reset each time the cache is called.</div>


* <div data-tips="true" data-tips-type="warning">Responses API: Specifies the expiration time for context storage and cache via <strong>expire_at</strong>. When the <code>current time</code> exceeds the <code>expiration time</code>, the storage expires. The cache lifecycle is not reset with the use of the cache/storage.</div>



<div data-tips="true" data-tips-type="warning">When the storage/cache of the Responses API expires, you need to recreate the storage/cache content via the <a href="https://docs.byteplus.com/en/docs/ModelArk/Create_model_request">API</a>.</div>



<Tabs>
<Tab zoneid="SeWDqkooAz" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
from byteplussdkarkruntime import Ark
import time

# Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
api_key = os.getenv('ARK_API_KEY')

client = Ark(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

response = client.responses.create(
    model="seed-2-0-lite-260228",
    input=[
            {
             "role": "system", 
             "content": "Hello"
            }
          ],
    caching={"type": "enabled"}, 
    thinking={"type": "disabled"},
    expire_at=int(time.time()) + 3600,
)
print(response.model_dump_json())
```



</Tab>
<Tab zoneid="cTXlcWLPqc" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    "time"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/responses"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    ctx := context.Background()

    resp, err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model: "seed-2-0-lite-260228",
        Input: &responses.ResponsesInput{
            Union: &responses.ResponsesInput_ListValue{
                ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{
                    {
                        Union: &responses.InputItem_EasyMessage{
                            EasyMessage: &responses.ItemEasyMessage{
                                Role:    responses.MessageRole_system,
                                Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "Hello"}},
                            },
                        },
                    },
                }},
            },
        },
        Caching:  &responses.ResponsesCaching{Type: responses.CacheType_enabled.Enum()},
        Thinking: &responses.ResponsesThinking{Type: responses.ThinkingType_disabled.Enum()},
        ExpireAt: volcengine.Int64(time.Now().Unix() + 3600),
    })
    if err != nil {
        fmt.Printf("response error: %v", err)
        return
    }
    fmt.Println(resp)
    fmt.Println(resp.GetUsage())
}
```



</Tab>
<Tab zoneid="q6YDfataHa" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;
import com.byteplus.ark.runtime.model.responses.item.ItemEasyMessage;
import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.model.responses.request.*;
import com.byteplus.ark.runtime.model.responses.response.ResponseObject;
import com.byteplus.ark.runtime.model.responses.constant.ResponsesConstants;
import com.byteplus.ark.runtime.model.responses.item.MessageContent;
import com.byteplus.ark.runtime.model.responses.common.ResponsesCaching;
import com.byteplus.ark.runtime.model.responses.common.ResponsesThinking;
import java.time.Instant;

public class demo {
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        // The base URL for model invocation
        ArkService arkService = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .input(ResponsesInput.builder()
                        .addListItem(ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_SYSTEM).content(
                                MessageContent.builder().stringValue("Hello").build()
                        ).build())
                        .build())
                .caching(ResponsesCaching.builder().type("enabled").build())
                .thinking(ResponsesThinking.builder().type(ResponsesConstants.THINKING_TYPE_DISABLED).build())
                .expireAt(Instant.now().getEpochSecond() + 3600)
                .build();
        ResponseObject resp = arkService.createResponse(request);
        System.out.println(resp);
        System.out.println(resp.getUsage());

        arkService.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="HPDu4PGeA6" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
import os
from openai import OpenAI
import time

# Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
api_key = os.getenv('ARK_API_KEY')

client = OpenAI(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

response = client.responses.create(
    model="seed-2-0-lite-260228",
    input=[
            {
             "role": "system", 
             "content": "Hello"
            }
          ],
    extra_body={
        "thinking":{"type":"disabled"},
        "caching":{"type":"enabled"},
        "expire_at": int(time.time()) + 3600 # The expiration time for storage and cache is 1 hour from the current time.
    }
)
print(response.model_dump_json())
```



</Tab>
<Tab zoneid="VMtxsykCQs" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
-H "Authorization: Bearer $ARK_API_KEY" \\
-H "Content-Type: application/json" \\
-d '{
    "model": "seed-2-0-lite-260228",
    "input":[
                {
                 "role":"system", 
                  "content":"Hello"
                }
          ],
    "expire_at":<The UTC Unix timestamp of the expiration time>,
    "caching":{
        "type":"enabled"
    },
    "thinking": {
        "type": "disabled"
    }
}'
```



</Tab>
</Tabs>


<span id="2c55c76f"></span>
# Delete cache

The Responses API supports deleting caches by ID, which works the same way as deleting historical conversations, as shown below. This allows you to independently control the amount of cached information based on your business needs, such as deleting unnecessary cached content to reduce redundant input and lower costs.


<Tabs>
<Tab zoneid="Ha7AcpPm0s" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
from byteplussdkarkruntime import Ark

api_key = os.getenv('ARK_API_KEY')
client = Ark(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

response = client.responses.delete("resp_0217****")
print(response)
```



</Tab>
<Tab zoneid="gu0oGnK1RG" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    ctx := context.Background()
    resp := client.DeleteResponse(ctx, "resp_0217****")
    fmt.Println()
    fmt.Println(resp)
}
```



</Tab>
<Tab zoneid="mAQY7wuZjQ" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;
import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.model.responses.request.*;
import com.byteplus.ark.runtime.model.responses.response.DeleteResponseResponse;

public class demo {
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");

        // The base URL for model invocation
        ArkService arkService = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();
        DeleteResponseResponse deleteResult = arkService.deleteResponse(
                DeleteResponseRequest.builder().responseId("resp_0217****").build()
        );

        System.out.println(deleteResult);

        arkService.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="cV09BGVJZl" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
from openai import OpenAI
import os

api_key = os.getenv('ARK_API_KEY')
client = OpenAI(    
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

response = client.responses.delete("resp_0217****")
print(response)
```



</Tab>
<Tab zoneid="HxHXM7PpCT" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses/resp_0217**** \\
  -X DELETE \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -H "Content-Type: application/json" \\
```



</Tab>
</Tabs>


Note that after you delete the cache for a specific round, the cached information for subsequent rounds will be recalculated and stored the next time a request is made. As shown in the following figure (the scenario in the figure is that the API is called to delete the conversation information of the 3rd round after the 5th round of request).

<span>![图片](https://asset.ark-doc-resources.com/flowcharts/responses-api/context-cache-01.svg) </span>

When making the 6th round of request, the information from the 4th and 5th rounds will be recalculated and cached, and this information will be billed as regular input instead of cached input.

<span id="c03763f2"></span>
# Instructions


* **store**: The prerequisite for writing to the cache is that storage is enabled, that is, manually set the **store** parameter to `true` or keep the default value (the default is `true`).

* **caching**:

   * **You can only write to the cache for the current round of conversation if cache writing is enabled for the previous round of conversation request**. Similarly, if a round of request needs to write to the cache, you must ensure that cache writing is enabled for all previous rounds of requests, that is, all previous rounds have `"caching": {"type": "enabled" }` configured. For example: If you want the 5th round of request to be able to write cache information, you need to keep cache writing enabled for round 1 to 4. If cache writing is disabled for any round of request, all subsequent rounds of conversation requests cannot be written to the cache.

   * As long as `"caching": {"type": "enabled" }` exists in previous rounds, json_schema is not supported, but json_object is supported.

   * The validity period of the cache can be customized via the `expire_at` parameter, with a maximum support of 7 days.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">store parameter: Controls whether to store the current round of request information and add it to the historical context for the next call. Its main function is to simplify context management: You do not need to manually manage the historical context. Instead, you can input the historical context by passing in the ID. Enabling the storage function is a prerequisite for writing to the cache, that is, the <strong>store</strong> parameter is set to <code>true</code>.</div>


<div data-tips="true" data-tips-type="tip">The caching parameter controls whether ModelArk writes the current round of information to the cache in a chained structure. When you pass in the ID for the next request call, it can reduce the calculation overhead in the prefill phase and lower the request cost (content input to the model through the cache will enjoy a higher discount).</div>



* <div data-tips="true" data-tips-type="tip">Models before Seed 1.8: Cache inputs and model responses, excluding chain\-of\-thought content.</div>


* <div data-tips="true" data-tips-type="tip">Seed 1.8 model: Caches the input content.</div>



<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">Note</div>


<div data-tips="true" data-tips-type="warning">During the version switching process, the cache is temporarily unavailable. Requests made using the Responses API will not hit the cache, but the content will be cached and incur cache storage fees. After version switching is completed, caches from historical rounds can be hit normally.</div>



* **instructions**: To write to the cache, the **instructions** parameter should be empty. If **instructions** is set in the current round of request, this round of conversation cannot call the existing cache, nor can it write the current round of information to the cache.

* **thinking**: The value of the **thinking** parameter in the request must be consistent with that of the previous round to use/write to the cache.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">If <code>"thinking":{"type":"auto"}</code> is set in the first round, subsequent rounds must also be set to <code>"thinking":{"type":"auto"}</code> if they need to use or write to the cache.</div>


<div data-tips="true" data-tips-type="tip">If the <strong>thinking</strong> parameter is not set in the first round (no value is assigned), subsequent requests must also not set the <strong>thinking</strong> parameter if they need to write to the cache or call the existing cache.</div>



* **tools**: The **tools** parameter can only be set in the first round of requests, and all subsequent conversations will carry the cached input of the tools parameter information by default.

   * Setting the **tools** parameter in subsequent rounds of conversation requests is not supported, which will cause conflicts and return errors.

   * If the first round of conversation information is deleted, all subsequent rounds of conversation will not carry the cached input of the **tools** parameter information, and the **tools** parameter cannot be configured either.


<span id="66b5f218"></span>
# Billing

See [Pricing](https://docs.byteplus.com/uwirt3wt/b53lzyom) for unit prices.

<span id="77706357"></span>
## Billing items


* **Input** (USD per thousand tokens): New text in the ongoing conversation, that is, historical conversation information that needs to be recalculated and cached after deletion.

* **Cached input** (USD per thousand tokens): The input is pre\-processed and cached content, which optimizes computing and storage overhead, and the billing rate is significantly lower than that of new input content.

* **Storage** (USD per thousand tokens per hour): Historical conversations are stored in the session cache, which incurs storage fees. The total fee is the sum of the fee of each natural hour, which equals to the maximum amount of cache used during that hour multiplied by the unit price.


<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">Note</div>



* <div data-tips="true" data-tips-type="warning">Storage fees are incurred as soon as the cache is created, and billing stops when the cache is manually deleted or expires.</div>


* <div data-tips="true" data-tips-type="warning">Storage fees are billed at each natural hour, such as 8:00. Any duration less than 1 hour is counted as 1 hour.</div>


* **Output** (USD per thousand tokens): Content generated by the model based on input information. The billing method is the same as the inference that does not use session cache.


<span id="fd37f379"></span>
## Billing rules

> The billed usage for each request can be viewed in the returned `usage` structure. See [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request) for details.


<span id="f0bb1ba1"></span>
### **Input token count**

It can be calculated by `input_tokens - cached_tokens`.

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">The input content of the Seed 1.8 model will include the chain\-of\-thought content of the previous round, so the number of input tokens will increase. You can manage the chain\-of\-thought content and tool call content by enabling the context editing feature to control the input tokens, where the hit cache is the intersection of the input content and the cached content after context editing.</div>


<span id="96dc7964"></span>
### **Storage fee**

Storage fees are only incurred after the cache is enabled in the request, that is, the parameter is configured as `"caching": {"type": "enabled" }`. Calculated by natural hour, the storage fee is calculated by accumulating the number of newly added cache tokens generated by each round of requests in that hour.

> Storage is calculated by natural hour, and any duration less than 1 hour is counted as 1 hour.



|Models |Models before Seed 1.8 |Seed 1.8 model |
|---|---|---|
|Cached content |Caches inputs and model responses, excluding chain\-of\-thought content. |Caches the input content. |
|Request diagram |<span>![图片](https://asset.ark-doc-resources.com/flowcharts/responses-api/context-cache-03.svg) </span> |<span>![图片](https://asset.ark-doc-resources.com/flowcharts/responses-api/context-cache-04.svg) </span> |
|Calculation for a single request |```Plain```<br>```- Cached content: input tokens + output tokens - chain-of-thought tokens```<br>```- Newly added cached content: cached content of the current round of requests - cached content from the previous round```<br>```- Cache storage fee: Within the cache validity period, the hourly storage fee is newly added cached content tokens × storage unit price```<br> |```Plain```<br>```- Cached content: input tokens```<br>```- Newly added cached content: cached content of the current round of requests - cached content from the previous round```<br>```- Cache storage fee: Within the cache validity period, the hourly storage fee is newly added cached content tokens × storage unit price```<br> |


<span id="1e793b8c"></span>
### Cost calculation

The cost of one request within 1 hour after enabling cache includes: token fee generated by the request and cache storage fee. Take one request as an example, the calculation formula is as follows:


* Fees of requests using cache


```Plain
= Input cost + Cached input cost + Output cost
= (input_tokens − cached_tokens) × input unit price
+ cached_tokens × cached input unit price
+ output_tokens × output unit price
```



* Cache storage fee


```Plain
= Newly added cache storage fee
= Newly added cached content tokens × storage unit price
= (Cached content of the current round of requests - cached content from the previous round) × storage unit price
```




