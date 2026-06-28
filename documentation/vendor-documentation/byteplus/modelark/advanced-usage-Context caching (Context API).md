This document explains how to use the Context API to implement session caching and prefix caching.

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">If you're new to ModelArk, see <a href="https://docs.byteplus.com/en/docs/ModelArk/1399008">Quick start</a> to get up and running quickly.</div>


<span id="f9fb2aaf"></span>
# Enable caching

Enable the caching service: On the [Model activation](https://console.byteplus.com/ark/region:ark+ap-southeast-1/openManagement) page, enable it in the **Cache pricing** column of the model list.

<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/5c747b7230be40fbb44b98d0a7b8894d~tplv-goo7wpa0wc-image.image) </span>

<span id="09c05dac"></span>
# Models and APIs

APIs:


* Context APIs: [Create context caching API](https://docs.byteplus.com/en/docs/ModelArk/1346559), [Context caching conversation API](https://docs.byteplus.com/en/docs/ModelArk/1346560).

* [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request): Recommended. It supports more models and more flexible usage. For tutorials, see [Context caching (Responses API)](https://docs.byteplus.com/en/docs/ModelArk/1602228).


Supported models: [Context caching](https://docs.byteplus.com/en/docs/ModelArk/1330310#476e6f25)

<span id="029c3928"></span>
# Session caching tutorial

> Jump directly to [Prefix caching tutorial](https://docs.byteplus.com/en/docs/ModelArk/1396491#c665d4d2)


Session caching is a session\-level cache that caches the session context, and continuously updates the cache content during the conversation, ensuring that each round of conversation can obtain the information of previous rounds to maintain the continuity. It is suitable for long conversations such as role\-playing and topic\-based chat. After enabling session caching, the content input through the cache will get a discount, which can effectively reduce usage costs.

> After you enable the caching service, storage costs will be incurred to store your context information.


<span id="18cf565a"></span>
## Quick start


<Tabs>
<Tab zoneid="Lbuh64XlPg" title="cURL">
<TabTitle>cURL</TabTitle>

<span id="ad8c3ef5"></span>
### 1. Create session cache

Before using session caching, you need to call the [Create context caching API](https://docs.byteplus.com/en/docs/ModelArk/1346559) to create the cache and write initial information. Then you can reference this cache with [Context caching conversation API](https://docs.byteplus.com/en/docs/ModelArk/1346560) to let ModelArk manage the historical conversation for you and reduce the costs.

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/context/create \\
--header "Authorization: Bearer $ARK_API_KEY" \\
--header 'Content-Type: application/json' \\
--data '{ 
    "model":"<YOUR_ENDPOINT_ID>", 
    "messages":[ 
        {"role":"system","content":"You are Jim. You always say 'I am Jim'."}
     ], 
     "ttl":3600, 
     "mode": "session"
}'
```


Note the following:


* Replace `$ARK_API_KEY` with your API key, or configure the API key as an environment variable.

* Replace `<YOUR_ENDPOINT_ID>` with your inference Endpoint ID.

* `"ttl":3600` means that the session cache TTL is 3600 seconds.

* `"mode": "session"` indicates that the session cache mode is used.


Model response preview:

```Bash
{
    "id": "<YOUR_CONTEXT_ID>",
    "model": "<YOUR_ENDPOINT_ID>",
    "ttl": "3600",
    "mode": "session",
    "truncation_strategy": {
            "type": "last_history_token",
            "last_history_token": 4096
            },
    "usage": {
        "prompt_tokens": 18,
        "completion_tokens": 0,
        "total_tokens": 18,
        "prompt_tokens_details": {
            "cached_tokens": 0
        }
    }
}
```


The returned basic information of the created session cache, where `<YOUR_CONTEXT_ID>` is the ID of the created session cache in the format of `ctx-****`. You need to record it and use it when requesting the model inference service later.

<span id="2c058d63"></span>
### 2. Use session cache for conversations

We use the [Context caching conversation API](https://docs.byteplus.com/en/docs/ModelArk/1346560) to conduct conversations using session cache.

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/context/chat/completions \\
--header "Authorization: Bearer $ARK_API_KEY" \\
--header 'Content-Type: application/json' \\
--data '{
    "context_id": "<YOUR_CONTEXT_ID>",
    "model": "<YOUR_ENDPOINT_ID>",
    "messages":[
        {
            "role":"user",
            "content": "Hello"
        }
    ]
}'
```


Note the following:


* Replace `$ARK_API_KEY` with your API key, or configure the API key as an environment variable.

* Replace `<YOUR_CONTEXT_ID>` with the ID of the session cache created earlier.

* Replace `<YOUR_ENDPOINT_ID>` with your inference Endpoint ID.


Model response preview:

```Bash
{
  "id": "****",
  "object": "chat.completion",
  "created": 167765****,
  "model": "<YOUR_ENDPOINT_ID>",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "I am Jim",
    },
    "finish_reason": "stop"
  }],
 "usage": {
    "prompt_tokens": 28,
    "completion_tokens": 4,
    "total_tokens": 32,
    "prompt_tokens_details": {
      "cached_tokens": 18
  }
}
```



</Tab>
<Tab zoneid="QSphBdjfKK" title="Python">
<TabTitle>Python</TabTitle>

```Python
import datetime
import os
# Install SDK: pip install byteplus-python-sdk-v2
from byteplussdkarkruntime import Ark

# Create your endpoint: https://console.byteplus.com/ark/region:ark+ap-southeast-1/endpoint
model = "<YOUR_ENDPOINT_ID>"

client = Ark(
    api_key=os.environ.get("ARK_API_KEY"),
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3",
)

if __name__ == "__main__":
    print("----- create context -----")
    response = client.context.create(
        model=model,
#         Specify the mode as Session cache
        mode="session",
        messages=[
            {"role": "system", "content": "You are Jim"},
        ],
#         Set cache retention to 60 minutes
        ttl=datetime.timedelta(minutes=60),
    )
    print(response)

    print("----- chat round 1 (non-stream) -----")
    chat_response = client.context.completions.create(
        context_id=response.id, # Specify context id
        model=model,
        messages=[
            {"role": "user", "content": "I'm Tom"},
        ],
        stream=False,
    )
    print(chat_response.choices[0].message.content)
    print(chat_response.usage)

    print("----- chat round 2 (streaming) -----")
    stream = client.context.completions.create(
        context_id=response.id, # Specify context id
        model=model,
        messages=[
            {"role": "user", "content": "Who are you, and who am I?"},
        ],
        stream=True,
        stream_options={
            "include_usage": True,
        },
    )
    for chunk in stream:
        if chunk.usage:
            print(chunk.usage)
        if not chunk.choices:
            continue
        print(chunk.choices[0].delta.content, end="")
```



</Tab>
<Tab zoneid="nvsRVn8wU5" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "io"
    "os"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/volcengine"
)

// The main function is the entry point of the program
func main() {
    // Replace with your inference Endpoint ID (https://docs.byteplus.com/en/docs/ModelArk/1099522)
    const Model = "<YOUR_ENDPOINT_ID>"
    // Create a client with an API key, get the API key from environment variables (https://docs.byteplus.com/en/docs/ModelArk/1361424)
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
        )
    // Create a new context
    goCtx := context.Background()

    // Print the prompt message for creating a context
    fmt.Println("----- create context -----")
    // Create a new context request
    createCtxReq := model.CreateContextRequest{
        // Set the model to the constant Model
        Model: Model,
        // Set the mode to session mode
        Mode: model.ContextModeSession,
        // Set initial messages
        Messages: []*model.ChatCompletionMessage{
            {
                // Set the role to system
                Role: model.ChatMessageRoleSystem,
                // Set the content as the system message
                Content: &model.ChatCompletionMessageContent{
                    // Set the string value to the system message content
                    StringValue: volcengine.String("You are Jim"),
                },
            },
        },
        // Set TTL to 3600 seconds
        TTL: volcengine.Int(3600),
    }

    // Send the context creation request and get the response
    createCtxRsp, err := client.CreateContext(goCtx, createCtxReq)
    // If an error occurs, print the error message and return
    if err != nil {
        fmt.Printf("create context error: %v\n", err)
        return
    }
    // Print the context creation response
    fmt.Printf("create context response: %v\n", createCtxRsp)

    // Print the prompt message for non-streaming chat
    fmt.Println("----- chat round 1 (non-stream) -----")
    // Create a new chat request
    req := model.ContextChatCompletionRequest{
        // Set the context ID to the ID from the context creation response
        ContextID: createCtxRsp.ID,
        // Set the model to the constant Model
        Model: Model,
        // Set the messages
        Messages: []*model.ChatCompletionMessage{
            {
                // Set the role to user
                Role: model.ChatMessageRoleUser,
                // Set content to user message
                Content: &model.ChatCompletionMessageContent{
                    // Set string value to user message content
                    StringValue: volcengine.String("My name is Tom"),
                },
            },
        },
    }

    // Send chat request and get response
    resp, err := client.CreateContextChatCompletion(goCtx, req)
    // If an error occurs, print the error message and return
    if err != nil {
        fmt.Printf("non-stream chat error: %v\n", err)
        return
    }
    // Print the content of the chat response
    fmt.Println(*resp.Choices[0].Message.Content.StringValue)

    // Print prompt information for streaming chat
    fmt.Println("----- chat round 2 (stream) -----")
    // Create a new chat request
    req = model.ContextChatCompletionRequest{
        // Set the context ID to the ID from the context creation response
        ContextID: createCtxRsp.ID,
        // Set the model to the constant Model
        Model: Model,
        // Set the messages
        Messages: []*model.ChatCompletionMessage{
            {
                // Set the role to user
                Role: model.ChatMessageRoleUser,
                // Set content to user message
                Content: &model.ChatCompletionMessageContent{
                    // Set string value to user message content
                    StringValue: volcengine.String("Who are you, and who am I?"),
                },
            },
        },
    }
    // Send chat request and get streaming response
    stream, err := client.CreateContextChatCompletionStream(goCtx, req)
    // If an error occurs, print the error message and return
    if err != nil {
        fmt.Printf("stream chat error: %v\n", err)
        return
    }
    // Defer closing the streaming response
    defer stream.Close()

    // Loop to receive streaming responses
    for {
        // Receive streaming response
        recv, err := stream.Recv()
        // If EOF is received, return
        if err == io.EOF {
            return
        }
        // If an error occurs, print the error message and return
        if err != nil {
            fmt.Printf("Stream chat error: %v\n", err)
            return
        }
        // If the received response contains choices
        if len(recv.Choices) > 0 {
            // Print the content of the choice
            fmt.Print(recv.Choices[0].Delta.Content)
        }
    }
}
```



</Tab>
<Tab zoneid="cIzJ1arovK" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.example;

import com.byteplus.ark.runtime.model.completion.chat.ChatCompletionResult;
import com.byteplus.ark.runtime.model.completion.chat.ChatMessage;
import com.byteplus.ark.runtime.model.completion.chat.ChatMessageRole;
import com.byteplus.ark.runtime.model.context.CreateContextRequest;
import com.byteplus.ark.runtime.model.context.CreateContextResult;
import com.byteplus.ark.runtime.model.context.chat.ContextChatCompletionRequest;
import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.Const;
import java.util.Collections;

public class ContextChatCompletionsExample {

    /**
     * Main method, program entry point
     * @param args Command line parameters
     */
    public static void main(String[] args) {

        // Get the API key from environment variables (https://docs.byteplus.com/en/docs/ModelArk/1361424)
        String apiKey = System.getenv("ARK_API_KEY");
        // Replace with your inference Endpoint ID (https://docs.byteplus.com/en/docs/ModelArk/1099522)
        String model = "<YOUR_ENDPOINT_ID>";
        // Create an ArkService instance
        ArkService service = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

        // Print the prompt message for creating a context
        System.out.println("\n----- create context -----");
        // Create context request
        CreateContextRequest createContextRequest = CreateContextRequest.builder()
                // Set model
                .model(model)
                // Set context mode to session mode
                .mode(Const.CONTEXT_MODE_SESSION)
                // Set system message
                .messages(Collections.singletonList(ChatMessage.builder().role(ChatMessageRole.SYSTEM)
                        .content("You are Jim").build()))
                // Set the time to live (in seconds) of the context
                .ttl(3600)
                .build();

        // Send the create context request and get the result
        CreateContextResult createContextResult = service.createContext(createContextRequest);
        // Print the ID of the created context
        System.out.println("created context, id = " + createContextResult.getId());

        // Print the prompt message for the first round of chat (non-streaming)
        System.out.println("\\n----- chat round 1 (non-stream) -----");
        // Create chat completion request
        ContextChatCompletionRequest chatCompletionRequest = ContextChatCompletionRequest.builder()
                // Set context ID
                .contextId(createContextResult.getId())
                // Set model
                .model(model)
                // Set user message
                .messages(Collections.singletonList(ChatMessage.builder().role(ChatMessageRole.USER)
                        .content("I am Tom").build()))
                .build();

        // Send the chat completion request and get the result
        ChatCompletionResult chatCompletionResult = service.createContextChatCompletion(chatCompletionRequest);
        // Iterate through and print the message content in the chat completion result
        chatCompletionResult.getChoices()
                .forEach(choice -> System.out.println(choice.getMessage().getContent()));

        // Print the prompt message for the second round of chat (streaming)
        System.out.println("\n----- chat round 2 (stream) -----");
        // Create a streaming chat completion request
        ContextChatCompletionRequest streamChatCompletionRequest = ContextChatCompletionRequest.builder()
                // Set context ID
                .contextId(createContextResult.getId())
                // Set model
                .model(model)
                // Set user message
                .messages(Collections.singletonList(ChatMessage.builder().role(ChatMessageRole.USER)
                        .content("Who are you, and who am I?").build()))
                .build();

        // Send the streaming chat completion request and process the result
        service.streamContextChatCompletion(streamChatCompletionRequest)
                // Handle errors
                .doOnError(Throwable::printStackTrace)
                // Traverse results in blocking mode
                .blockingForEach(
                        choice -> {
                            // If the result is not empty, print the message content
                            if (! choice.getChoices().isEmpty()) {
                                System.out.print(choice.getChoices().get(0).getMessage()
                                        .getContent());
                            }
                        });

        // Shut down the service
        service.shutdownExecutor();
    }
}
```



</Tab>
</Tabs>


<span id="d86010f4"></span>
## Typical usage

<span id="f6eb27bb"></span>
### Manually manage session cache

For models that support [rolling_tokens mode](https://docs.byteplus.com/en/docs/ModelArk/1396491#879053fc), you can create a session cache using the following method, and enable automatic or manual session cache management as needed.

```HTTP
curl https://ark.ap-southeast.bytepluses.com/api/v3/context/create \
--header "Authorization: Bearer $ARK_API_KEY" \
--header 'Content-Type: application/json' \
--data '{ 
    "model":"<YOUR_ENDPOINT_ID>", 
    "messages":[ 
        {"role":"system","content":"You are Jim. You always say 'I am Jim'."}
     ], 
     "ttl":3600, 
     "mode": "session",
     "truncation_strategy":{ 
         "type":"rolling_tokens", 
         "rolling_tokens": false 
         }
}'
```


Set `truncation_strategy.type` to `rolling_tokens` to create a session cache.


* To process manually when the session cache upper limit is reached, you can set `truncation_strategy.rolling_tokens` to `false`. When the length of historical messages exceeds the context length, the model will stop outputting, and return `finish_reason` as `length` in the response. After you get this information, you can perform subsequent processing as needed.

* To process automatically when the session cache upper limit is reached, you can set `truncation_strategy.rolling_tokens` to `true`, then the default processing method will be used. See [rolling_tokens mode](https://docs.byteplus.com/en/docs/ModelArk/1396491#879053fc) for the processing method.


<span id="7900ebcf"></span>
## Instructions


* To learn about session cache and prefix cache, see [How it works](https://docs.byteplus.com/en/docs/ModelArk/1398933#2ef90d43).

* The session cache API is a stateful API, which does not support concurrent calls to the same session cache, that is, you cannot initiate multiple requests with the same session cache ID (`context_id`) at the same time.

* Partial mode (also known as [Prefill-based response](https://docs.byteplus.com/en/docs/ModelArk/1359497)) is not supported. When calling the [Create context caching API](https://docs.byteplus.com/en/docs/ModelArk/1346559), the `role` of the last message in the submitted `messages` array can be `user` or `system`, but cannot be `assistant`.

   ```JSON
   // Correct example
   "messages":[
       {"role":"user","content":"Who are you"},
       {"role":"assistant","content":"I'm Jim"},
       {"role":"user","content":"What's the weather like today"}
    ],
   ```
   

   ```JSON
    // Incorrect example
   "messages":[
       {"role":"user","content":"Who are you"},
       {"role":"assistant","content":"I'm Jim"}
   ],
   ```
   

* Session cache currently only supports online inference, and does not support use with batch inference.


<span id="c03b7f8c"></span>
## Cache limits

As the number of conversation rounds increases, the content will reach the upper limit of the session cache. According to different processing methods, it can be divided into 2 modes.

<span id="6fa694f7"></span>
### last_history_tokens mode

When the upper limit is reached, the information window rolls over, following the first\-in first\-out policy. When the cache upper limit is reached, the earliest cached conversation records are deleted (initial messages written to the cache when creating the session cache will not be deleted) before new conversation information is stored. In this mode, rolling data does not incur additional computing costs.

<span id="879053fc"></span>
### rolling_tokens mode

When the upper limit is reached, a fixed amount of information is deleted and recalculated. A fixed length A is used to limit the upper limit of the session cache, and a fixed length B is used to control the length of the context to be deleted. When the session cache reaches the upper limit \- length A, the following two actions are performed:


1. Clear stale messages of length B from the session cache (initial messages written to the cache when creating the session cache will not be deleted) to free up storage space for subsequent new messages.

2. Recalculate the historical information in the cache to ensure the coherence between the model's response and historical interactions.

   For your reference, here is the specific calculation logic: Take the seed\-2\-0\-lite\-260228 model as an example. When the number of tokens in the session cache reaches `256k (maximum context length) - 128k (maximum output length)`, 128k of stale historical information (except initial messages) will be deleted, and then the retained cache content will be recalculated and stored.

   For the round where recalculation is triggered after reaching the session cache upper limit, the retained historical information will be calculated and stored in the same way as new messages. You can observe that the token ratio of the session cache in this round drops to 0, so there are no cached input tokens in this round, but it will return to normal later.


<span id="82ae22e3"></span>
## Expiration time

Timing starts when the session cache is not in use. When the TTL (Time To Live) is reached, the cache will be deleted. If it is used in the meantime, the TTL of this cache will be reset and the cache will be retained.

> Example: You created session caches A and B at 8:00, and set the TTL to 2 hours. At 10:00, cache A has not been used, and cache B was used at 9:00. As a result, cache A will be deleted, and B still has 1 hour of TTL remaining.


<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">Note</div>


<div data-tips="true" data-tips-type="warning">All session caches will occupy cache space before they are deleted, thus incurring storage fees. You can set a balanced TTL according to your business requirements to reduce inference costs with session caches, while avoiding unnecessary storage costs.</div>


<span id="8b9c585e"></span>
## Billing

See [Pricing](https://docs.byteplus.com/en/docs/ModelArk/1544106) for unit prices.


<Tabs>
<Tab zoneid="UMYzSzyXo7" title="Billable items">
<TabTitle>Billable items</TabTitle>

Compared to not using Session caching, model service fees incur in:


* **Input** (USD per thousand tokens): In new requests, you do not need to resend historical conversations. Input tokens are only from new text added to the ongoing conversation.

   When recalculation is triggered in rolling_tokens mode, the saved historical conversations will be recalculated and cached, and billed the same as new input content.

* **Cached input** (USD per thousand tokens): Content used from the cache. ModelArk automatically processes historical records \- the cached input content \- and inputs them to the model. Although this approach incurs storage fees, it reduces the overall costs significantly due to the reduced computing and storage costs.

* **Storage** (USD per thousand tokens per hour): Historical conversations are stored in the session cache, which incurs storage fees. The calculation method is to accumulate the maximum amount of cache used per natural hour multiplied by the unit price. Example (unit price is for illustration only): If the unit price is 0.000017 USD per thousand tokens per hour, the maximum cache usage of the session cache in the first hour is 10k tokens, and the maximum cache usage of the session cache in the second hour is 15k tokens, then the storage fee is: `0.000017*10 + 0.000017*15 = 0.000425 USD`


<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">warning</div>



* <div data-tips="true" data-tips-type="warning">Fees are incurred as soon as the session cache is created, and stop when the session cache is deleted (when TTL is reached due to inactivity).</div>


* <div data-tips="true" data-tips-type="warning">Storage fees are billed at each natural hour, such as 8:00, 9:00, etc. Any duration less than 1 hour is counted as 1 hour.</div>


* **Output** (USD per thousand tokens): Content generated by the model based on input information. The billing method is the same as the inference that does not use session cache.


</Tab>
<Tab zoneid="IPwVn5TNlj" title="Billing rules">
<TabTitle>Billing rules</TabTitle>

The following describes the billing rules for requests using a specific cache (a specific Context ID after the cache is created).

The billable usage for each call can be viewed in the returned `usage` structure.

```JSON
"usage": {
    "prompt_tokens": 20,
    "completion_tokens": 8,
    "total_tokens": 28,
    "prompt_tokens_details": {
      "cached_tokens": 10
    }
}
```


The meaning of each parameter is as follows:


* `prompt_tokens`: The total number of tokens input to the model for processing in this request.

* `completion_tokens`: The number of tokens returned by the model in this request, that is, the amount of output tokens corresponding to the **Output** billing item.

* `total_tokens`: The total number of tokens used in this request.

* `prompt_tokens_details.cached_tokens`: The amount of cached input tokens in this request, corresponding to the **Cached input** billing item.


The following are important data for fee calculation:


* **Input token amount**: Can be obtained by subtracting `cached_tokens` from `prompt_tokens`.

* **Storage fee**: Calculated per natural hour, based on the maximum value of `cache_tokens` during that hour. If there is no request or cache change during that hour, the maximum value of `cache_tokens` from the previous hour is used, and so on.


The fees for a specific cache are divided into token fees incurred by requests and storage fees, and the calculation logic is as follows:

```Plain
Fees of requests using cache
= Sum of fees for all requests using cache
= Request 1 (Input fee + Cached input fee + Output fee) + Request 2 (Input fee + Cached input fee + Output fee) + ...+ Request N (Input fee + Cached input fee + Output fee)
= Request 1 ((prompt_tokens - cached_tokens) * Input unit price + cached_tokens * Cached input unit price + completion_tokens * Output unit price )
+ Request 2 ((prompt_tokens - cached_tokens) * Input unit price + cached_tokens * Cached input unit price + completion_tokens * Output unit price )
+...
+ Request N ((prompt_tokens - cached_tokens) * Input unit price + cached_tokens * Cached input unit price + completion_tokens * Output unit price )
```


```Plain
Cache storage cost
= Sum of cache storage fees for each natural hour during the cache life cycle
= Maximum cache tokens in hour 1 * Storage unit price + Maximum cache tokens in hour 2 * Storage unit price + ... + Maximum cache tokens in hour N * Storage unit price
```


> Natural hour: Based on the actual full hour. For example, if cache storage starts at 13:59, it will be counted as the first hour when it reaches 14:00.


</Tab>
</Tabs>


<span id="b65d52eb"></span>
## How it works

See [Session caching](https://docs.byteplus.com/en/docs/ModelArk/1398933#0b8d3b3d).

<span id="c665d4d2"></span>
# Prefix caching tutorial

> Jump directly to [Session caching tutorial](https://docs.byteplus.com/en/docs/ModelArk/1396491#029c3928)


Using prefix cache can reduce the cost of model calls. You can store commonly used information such as roles, backgrounds, and more as initialization information in advance. When calling the model later, you do not need to send this information to the model repeatedly, which reduces overhead and costs. It is especially suitable for applications with repeated prompts or standardized opening texts.

<span id="cbada5ca"></span>
## Quick start


<Tabs>
<Tab zoneid="O1YLsrpDmW" title="cURL">
<TabTitle>cURL</TabTitle>

<span id="610f8556"></span>
### 1. Create a prefix cache

Before using the prefix cache, you need to call the [Create context caching API](https://docs.byteplus.com/en/docs/ModelArk/1346559) to create the cache and write initial information. Simply reference this cache in the [Context caching conversation API](https://docs.byteplus.com/en/docs/ModelArk/1346560) in later requests to retain the initial information for you and reduce the cost.

```HTTP
curl https://ark.ap-southeast.bytepluses.com/api/v3/context/create \\
--header "Authorization: Bearer $ARK_API_KEY" \\
--header 'Content-Type: application/json' \\
--data '{ 
    "model":"<YOUR_ENDPOINT_ID>", 
    "messages":[ 
        {"role":"system","content":"You are Jim. You always say 'I am Jim'."}
     ], 
     "ttl":3600, 
     "mode": "common_prefix"
}'
```


Note the following:


* Replace `$ARK_API_KEY` with your API key, or configure the API key as an environment variable.

* Replace `<YOUR_ENDPOINT_ID>` with your inference Endpoint ID.

* `"ttl":3600` indicates the TTL of the prefix cache, which is 3600 seconds here.

* `"mode": "common_prefix"` indicates the prefix cache mode in use.


Model response preview:

```Bash
{
    "id": "<YOUR_CONTEXT_ID>",
    "model": "<YOUR_ENDPOINT_ID>",
    "ttl": "259200",
    "mode": "common_prefix",
    "usage": {
        "prompt_tokens": 18,
        "completion_tokens": 0,
        "total_tokens": 18,
        "prompt_tokens_details": {
            "cached_tokens": 0
        }
    }
}
```


The returned basic information of the created prefix cache, where `<YOUR_CONTEXT_ID>` is the ID of the created prefix cache in the format of `ctx-****`. You need to record it and use it when requesting the model inference service later.

<span id="2ba6482f"></span>
### 2. Use prefix cache for conversations

We use the [Context caching conversation API](https://docs.byteplus.com/en/docs/ModelArk/1346560) to conduct conversations using prefix cache.

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/context/chat/completions \\
--header "Authorization: Bearer $ARK_API_KEY" \\
--header 'Content-Type: application/json' \\
--data '{
    "context_id": "<YOUR_CONTEXT_ID>",
    "model": "<YOUR_ENDPOINT_ID>",
    "messages":[
        {
            "role":"user",
            "content": "Hello"
        }
    ]
}'
```


Note the following:


* Replace `$ARK_API_KEY` with your API key, or configure the API key as an environment variable.

* Replace `<YOUR_CONTEXT_ID>` with the ID of the cache created earlier.

* Replace `<YOUR_ENDPOINT_ID>` with your inference Endpoint ID.


Model response preview:

```Bash
{
  "id": "****",
  "object": "chat.completion",
  "created": 167765****,
  "model": "<YOUR_ENDPOINT_ID>",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "I am Jim.",
    },
    "logprobs": null,
    "finish_reason": "stop"
  }],
 "usage": {
    "prompt_tokens": 28,
    "completion_tokens": 5,
    "total_tokens": 33,
    "prompt_tokens_details": {
      "cached_tokens": 18
  }
}
```



</Tab>
<Tab zoneid="RYRcDflnpp" title="Python">
<TabTitle>Python</TabTitle>

```Python
# Import the datetime module for processing dates and times
import datetime
# Import the os module for obtaining environment variables
import os
# You need to upgrade the ModelArk Python SDK to version 1.0.116 or later, run `pip install --upgrade 'volcengine-python-sdk[ark]'`
from byteplussdkarkruntime import Ark

# Get the API key from environment variables (https://docs.byteplus.com/en/docs/ModelArk/1361424)
api_key = os.environ.get("ARK_API_KEY")
# Replace with your inference Endpoint ID (https://docs.byteplus.com/en/docs/ModelArk/1099522)
model = "<YOUR_ENDPOINT_ID>"

# Create a ModelArk client instance and pass in the API key
client = Ark(
    api_key=api_key,
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3",
    )

# If the current script is running as the main program
if __name__ == "__main__":
#     Print the prompt message for context creation
    print("----- create context -----")
#     Call the context.create method of the client to create a session context
    response = client.context.create(
#         Specify the model
        model=model,
#         Specify the mode as session
        mode="common_prefix",
#         Set the message list, which includes a message with the system role
        messages=[
            {"role": "system", "content": "You are Jim"},
        ],
#         Set the time to live (TTL) of the session to 60 minutes
        ttl=datetime.timedelta(minutes=60),
    )
#     Print the response result of the context creation
    print(response)

#     Print the prompt message for the first round of non-streaming chat
    print("----- chat round 1 (non-stream) -----")
#     Call the context.completions.create method of the client to perform non-streaming chat
    chat_response = client.context.completions.create(
#         Specify the context ID
        context_id=response.id,
#         Specify the model
        model=model,
#         Set the message list, which includes a message with the user role
        messages=[
            {"role": "user", "content": "I'm Tom"},
        ],
#         Set to non-streaming mode
        stream=False,
    )
#     Print the message content of the chat response
    print(chat_response.choices[0].message.content)
#     Print the usage information of the chat response
    print(chat_response.usage)

#     Print the prompt message for the second round of streaming chat
    print("----- chat round 2 (streaming) -----")
#     Call the context.completions.create method of the client to perform streaming chat
    stream = client.context.completions.create(
#         Specify the context ID
        context_id=response.id,
#         Specify the model
        model=model,
#         Set the message list, which includes a message with the user role
        messages=[
            {"role": "user", "content": "Who are you, and who am I?"},
        ],
#         Set streaming options, including usage information
        stream_options={
            "include_usage": True,
        },
#         Set to streaming mode
        stream=True,
    )
#     Iterate through each chunk of the streaming response
    for chunk in stream:
#         If the chunk contains usage information, print the usage
        if chunk.usage:
            print(chunk.usage)
#         If the chunk does not contain choices information, proceed to the next chunk
        if not chunk.choices:
            continue
        print(chunk.choices[0].delta.content, end="")
```



</Tab>
<Tab zoneid="SLOBhhvfW4" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "io"
    "os"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/volcengine"
)

// The main function is the entry point of the program
func main() {
    // Replace with your inference Endpoint ID (https://docs.byteplus.com/en/docs/ModelArk/1099522)
    const Model = "<YOUR_ENDPOINT_ID>"
    // Create a client with an API key, get the API key from environment variables (https://docs.byteplus.com/en/docs/ModelArk/1361424)
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
        )
    // Create a new context
    goCtx := context.Background()

    // Print the prompt message for creating a context
    fmt.Println("----- create context -----")
    // Create a new context request
    createCtxReq := model.CreateContextRequest{
        // Set the model to the constant Model
        Model: Model,
        // Set the mode to session mode
        Mode: model.ContextModeCommonPrefix,
        // Set initial messages
        Messages: []*model.ChatCompletionMessage{
            {
                // Set the role to system
                Role: model.ChatMessageRoleSystem,
                // Set the content as the system message
                Content: &model.ChatCompletionMessageContent{
                    // Set the string value to the system message content
                    StringValue: volcengine.String("You are Jim"),
                },
            },
        },
        // Set TTL to 3600 seconds
        TTL: volcengine.Int(3600),
    }

    // Send the context creation request and get the response
    createCtxRsp, err := client.CreateContext(goCtx, createCtxReq)
    // If an error occurs, print the error message and return
    if err != nil {
        fmt.Printf("create context error: %v\n", err)
        return
    }
    // Print the context creation response
    fmt.Printf("create context response: %v\n", createCtxRsp)

    // Print the prompt message for non-streaming chat
    fmt.Println("----- chat round 1 (non-stream) -----")
    // Create a new chat request
    req := model.ContextChatCompletionRequest{
        // Set the context ID to the ID from the context creation response
        ContextID: createCtxRsp.ID,
        // Set the model to the constant Model
        Model: Model,
        // Set the messages
        Messages: []*model.ChatCompletionMessage{
            {
                // Set the role to user
                Role: model.ChatMessageRoleUser,
                // Set content to user message
                Content: &model.ChatCompletionMessageContent{
                    // Set string value to user message content
                    StringValue: volcengine.String("My name is Tom"),
                },
            },
        },
    }

    // Send chat request and get response
    resp, err := client.CreateContextChatCompletion(goCtx, req)
    // If an error occurs, print the error message and return
    if err != nil {
        fmt.Printf("non-stream chat error: %v\n", err)
        return
    }
    // Print the content of the chat response
    fmt.Println(*resp.Choices[0].Message.Content.StringValue)

    // Print prompt information for streaming chat
    fmt.Println("----- chat round 2 (stream) -----")
    // Create a new chat request
    req = model.ContextChatCompletionRequest{
        // Set the context ID to the ID from the context creation response
        ContextID: createCtxRsp.ID,
        // Set the model to the constant Model
        Model: Model,
        // Set the messages
        Messages: []*model.ChatCompletionMessage{
            {
                // Set the role to user
                Role: model.ChatMessageRoleUser,
                // Set content to user message
                Content: &model.ChatCompletionMessageContent{
                    // Set string value to user message content
                    StringValue: volcengine.String("Who are you, and who am I?"),
                },
            },
        },
    }
    // Send chat request and get streaming response
    stream, err := client.CreateContextChatCompletionStream(goCtx, req)
    // If an error occurs, print the error message and return
    if err != nil {
        fmt.Printf("stream chat error: %v\n", err)
        return
    }
    // Defer closing the streaming response
    defer stream.Close()

    // Loop to receive streaming responses
    for {
        // Receive streaming response
        recv, err := stream.Recv()
        // If EOF is received, return
        if err == io.EOF {
            return
        }
        // If an error occurs, print the error message and return
        if err != nil {
            fmt.Printf("Stream chat error: %v\n", err)
            return
        }
        // If the received response contains choices
        if len(recv.Choices) > 0 {
            // Print the content of the choice
            fmt.Print(recv.Choices[0].Delta.Content)
        }
    }
}
```



</Tab>
<Tab zoneid="DqmCJk8Mzf" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.example;

import com.byteplus.ark.runtime.model.completion.chat.ChatCompletionResult;
import com.byteplus.ark.runtime.model.completion.chat.ChatMessage;
import com.byteplus.ark.runtime.model.completion.chat.ChatMessageRole;
import com.byteplus.ark.runtime.model.context.CreateContextRequest;
import com.byteplus.ark.runtime.model.context.CreateContextResult;
import com.byteplus.ark.runtime.model.context.chat.ContextChatCompletionRequest;
import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.Const;
import java.util.Collections;

public class ContextChatCompletionsExample {

    /**
     * Main method, program entry point
     * @param args Command line parameters
     */
    public static void main(String[] args) {

        // Get the API key from environment variables (https://docs.byteplus.com/en/docs/ModelArk/1361424)
        String apiKey = System.getenv("ARK_API_KEY");
        // Replace with your inference Endpoint ID (https://docs.byteplus.com/en/docs/ModelArk/1099522)
        String model = "<YOUR_ENDPOINT_ID>";
        // Create an ArkService instance
        ArkService service = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

        // Print the prompt message for creating a context
        System.out.println("\\n----- create context -----");
        // Create context request
        CreateContextRequest createContextRequest = CreateContextRequest.builder()
                // Set model
                .model(model)
                // Set context mode to session mode
                .mode(Const.CONTEXT_MODE_COMMON_PREFIX)
                // Set system message
                .messages(Collections.singletonList(ChatMessage.builder().role(ChatMessageRole.SYSTEM)
                        .content("You are Jim").build()))
                // Set the time to live (in seconds) of the context
                .ttl(3600)
                .build();

        // Send the create context request and get the result
        CreateContextResult createContextResult = service.createContext(createContextRequest);
        // Print the ID of the created context
        System.out.println("created context, id = " + createContextResult.getId());

        // Print the prompt message for the first round of chat (non-streaming)
        System.out.println("\\n----- chat round 1 (non-stream) -----");
        // Create chat completion request
        ContextChatCompletionRequest chatCompletionRequest = ContextChatCompletionRequest.builder()
                // Set context ID
                .contextId(createContextResult.getId())
                // Set model
                .model(model)
                // Set user message
                .messages(Collections.singletonList(ChatMessage.builder().role(ChatMessageRole.USER)
                        .content("I am Tom").build()))
                .build();

        // Send the chat completion request and get the result
        ChatCompletionResult chatCompletionResult = service.createContextChatCompletion(chatCompletionRequest);
        // Iterate through and print the message content in the chat completion result
        chatCompletionResult.getChoices()
                .forEach(choice -> System.out.println(choice.getMessage().getContent()));

        // Print the prompt message for the second round of chat (streaming)
        System.out.println("\\n----- chat round 2 (stream) -----");
        // Create a streaming chat completion request
        ContextChatCompletionRequest streamChatCompletionRequest = ContextChatCompletionRequest.builder()
                // Set context ID
                .contextId(createContextResult.getId())
                // Set model
                .model(model)
                // Set user message
                .messages(Collections.singletonList(ChatMessage.builder().role(ChatMessageRole.USER)
                        .content("Who are you, and who am I?").build()))
                .build();

        // Send the streaming chat completion request and process the result
        service.streamContextChatCompletion(streamChatCompletionRequest)
                // Handle errors
                .doOnError(Throwable::printStackTrace)
                // Traverse results in blocking mode
                .blockingForEach(
                        choice -> {
                            // If the result is not empty, print the message content
                            if (! choice.getChoices().isEmpty()) {
                                System.out.print(choice.getChoices().get(0).getMessage()
                                        .getContent());
                            }
                        });

        // Shut down the service
        service.shutdownExecutor();
    }
}
```



</Tab>
</Tabs>


<span id="36d1d079"></span>
## Supported models

See [Context caching](https://docs.byteplus.com/en/docs/ModelArk/1330310#476e6f25).

<span id="8d90bd01"></span>
## Limitations


* Unlike session caching, prefix caching supports concurrent calls.

* Partial mode (also known as [Prefill-based response](https://docs.byteplus.com/en/docs/ModelArk/1359497)) is not supported. When calling the [Context caching conversation API](https://docs.byteplus.com/en/docs/ModelArk/1346560), the `role` parameter of the last message in the `messages` array can be `user` or `system`, not `assistant`.

* The valid value range of the prefix cache TTL is 1 hour to 7 days, that is, the value range of the `ttl` parameter (unit: second) is [3600, 604800]. For specific parameter configuration instructions, see [Request body](https://docs.byteplus.com/en/docs/ModelArk/1346559?_vtm_=a78999.b69280.0_0.0_0.0.14_undefined#request-body).

* Prefix cache currently only supports online inference, and cannot be used together with batch inference.

   If you need to use Java to call the model inference service, you can use the ModelArk Java SDK to easily use the prefix cache.


<span id="3c13d4e8"></span>
## Billing

See [Pricing](https://docs.byteplus.com/en/docs/ModelArk/1544106) for unit prices.


<Tabs>
<Tab zoneid="sdPXg5xmi7" title="Billable items">
<TabTitle>Billable items</TabTitle>

Similar to session caching, prefix caching uses a transparent billing method, based on the following four key factors:


* Input (USD per thousand tokens): Input tokens are from the new text sent to the large language model, excluding the cached prefix.

* Output (USD per thousand tokens): Output tokens are from the text generated by the large language model. Billing for output tokens is the same as that for standard large language model usage.

* Cached input (USD per thousand tokens): A cached input fee is incurred each time tokens are retrieved from the prefix cache. This fee is usually lower than the input token fee.

* Storage (USD per thousand tokens per hour): Storage fees are billed hourly, based on the maximum number of tokens stored for all prefixes in each natural hour. Storage fees will continue until the time to live (TTL) of the prefix expires.


</Tab>
<Tab zoneid="UDBK8db2TT" title="Billing rules">
<TabTitle>Billing rules</TabTitle>

When you initiate a request with prefix cache, fees are incurred for the following behaviors:


* New input.

* Cached input.

* Output generated by the model.

* Initial information storage fee (billed by the size of stored information and hours).


The usage of each model service call, except for the initial information storage fee, can be viewed in the returned `usage` structure.

```JSON
{
    ...
    "usage": {
        "prompt_tokens": 20,
        "completion_tokens": 8,
        "total_tokens": 28,
        "prompt_tokens_details": {
          "cached_tokens": 10
      }
  }
```


The meaning of each parameter is as follows:


* `prompt_tokens`: The total number of tokens input to the model for processing in this request.

* `completion_tokens`: The number of tokens returned by the model in this request, that is, the amount of output tokens corresponding to the **Output** billing item.

* `total_tokens`: The total number of tokens used in this request.

* `prompt_tokens_details.cached_tokens`: Amount of cached input tokens for the model in this request, corresponding to the **Cached input** billing item.


The following are important data for fee calculation:


* **Input token count**: Can be obtained by `prompt_tokens` minus `cached_tokens`.

* **Storage fee**: The value of `cache_tokens` is calculated every natural hour.


The fees for a specific cache are divided into token fees incurred by requests and storage fees, and the calculation logic is as follows:

```Plain
Fees of requests using cache
= Sum of fees for all requests using cache
= Request 1 (Input fee + Cached input fee + Output fee) + Request 2 (Input fee + Cached input fee + Output fee) + ...+ Request N (Input fee + Cached input fee + Output fee)
= Request 1 ((prompt_tokens - cached_tokens) * Input unit price + cached_tokens * Cached input unit price + completion_tokens * Output unit price )
+ Request 2 ((prompt_tokens - cached_tokens) * Input unit price + cached_tokens * Cached input unit price + completion_tokens * Output unit price )
+...
+ Request N ((prompt_tokens - cached_tokens) * Input unit price + cached_tokens * Cached input unit price + completion_tokens * Output unit price )
```


```Plain
Cache storage cost
= Sum of cache storage fees for each natural hour during the cache lifecycle
= Cache token count * Number of natural storage hours * Storage unit price
```



> * Number of natural storage hours: It may differ from the actual storage duration, subject to the actual hour mark. For example, if cache storage starts at 13:59, it will be counted as 1 hour when it reaches 14:00.

> * Cost optimization tip: Analyze the usage frequency of initial information, properly configure the cache TTL, and balance cache benefits and storage costs.


</Tab>
</Tabs>


<span id="d85c1057"></span>
## How it works

See [Prefix caching](https://docs.byteplus.com/en/docs/ModelArk/1398933#b33acdd2).



