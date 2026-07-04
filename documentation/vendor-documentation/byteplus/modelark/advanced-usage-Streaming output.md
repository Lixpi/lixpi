By default, the ModelArk API returns results in a single HTTP response after the model finishes generating all content. For long outputs, this can increase end\-to\-end latency.

With streaming responses, the model continuously sends generated chunks as they become available. This lets you observe intermediate output in real time and start processing or rendering partial results immediately.

<span id="e9511cf7"></span>
# Benefits of streaming output


* **Better perceived latency**: You don’t need to wait for the full response to finish generating—you can start consuming or rendering partial content immediately.

* **Real\-time progress visibility**: In multi\-turn interactions, streaming makes it easier to track the task’s current processing stage as it happens.

* **Higher fault tolerance**: If an error occurs mid\-stream, you can still retain the content already generated, avoiding the “all\-or\-nothing” behavior of non\-streaming responses.

* **Simpler timeout handling**: Keeping an active client–server connection reduces the risk of timeouts for long\-running or complex requests.


The following provides a brief preview of streaming output using the Python SDK:

<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/e3e953f1e9bd4685800601958647faf3~tplv-goo7wpa0wc-image.image) </span>

<span id="f1d9aa59"></span>
# Instructions

<span id="aba1f93c"></span>
## Enable streaming

Enable streaming output by setting the **stream** field to `true`.

<span id="9346c907"></span>
## Example request


* Chat API sample code:



<Tabs>
<Tab zoneid="n8UsmwGFL7" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -d '{
    "model": "seed-2-0-lite-260228",
    "messages": [
        {
            "role": "user",
            "content": "What are some common cruciferous plants?"
        }
    ],
    "stream": true
  }'
```



</Tab>
<Tab zoneid="edG2Sbot0H" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
# Install SDK:pip install byteplus-python-sdk-v2
from byteplussdkarkruntime import Ark 

client = Ark(
    #The base URL for model invocation
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
)

completion = client.chat.completions.create(
    #Replace with Model ID
    model = "seed-2-0-lite-260228",
    messages=[
        {"role": "user", "content": "What are some common cruciferous plants?"},
    ],
    stream=True,
)

# Ensure the connection is closed automatically to prevent connection leaks.
with completion:
    for chunk in completion:
        if chunk.choices[0].delta.content is not None:
            print(chunk.choices[0].delta.content, end="")
```


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">tip</div>


<div data-tips="true" data-tips-type="tip"><code>with completion</code>: When an exception occurs within the with code block, the object's <strong>exit</strong>() method is automatically called to perform cleanup. When settings such as max_tokens and other interruption conditions are applied, it can prevent the socket layer from being overloaded with data and ultimately causing the program to freeze.</div>



</Tab>
<Tab zoneid="HG12FXDpIz" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        //The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )

    ctx := context.Background()

    fmt.Println("----- standard request -----")
    req := model.CreateChatCompletionRequest{
        //Replace with Model ID
       Model: "seed-2-0-lite-260228",
        Messages: []*model.ChatCompletionMessage{
            {
                Role: model.ChatMessageRoleUser,
                Content: &model.ChatCompletionMessageContent{
                    StringValue: byteplus.String("What are some common cruciferous plants?"),
                },
            },
        },
        Stream: byteplus.Bool(true),
    }

    // Call the CreateChatCompletionStream method instead of the non-streaming CreateChatCompletion method, otherwise streaming responses cannot be obtained.
    resp, err := client.CreateChatCompletionStream(ctx, req)
    if err != nil {
        fmt.Printf("standard chat error: %v", err)
        return
    }

    defer resp.Close()
    for {
        chunk, err := resp.Recv()
        if err != nil {
            fmt.Printf("stream error: %v", err)
            break
        }
        fmt.Print(chunk.Choices[0].Delta.Content)
    }
    fmt.Println()
}
```



</Tab>
<Tab zoneid="L3d2uG0iU3" title="Java">
<TabTitle>Java</TabTitle>

```java
package com.ark.runtime;

import com.byteplus.ark.runtime.model.completion.chat.ChatCompletionRequest;
import com.byteplus.ark.runtime.model.completion.chat.ChatMessage;
import com.byteplus.ark.runtime.model.completion.chat.ChatMessageRole;
import com.byteplus.ark.runtime.service.ArkService;
import java.util.ArrayList;
import java.util.List;

public class ChatCompletionsExample {
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        //The base URL for model invocation
        ArkService service = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();
        final List<ChatMessage> messages = new ArrayList<>();
        final ChatMessage userMessage = ChatMessage.builder().role(ChatMessageRole.USER).content("What are some common cruciferous plants?").build();
        messages.add(userMessage);

        ChatCompletionRequest chatCompletionRequest = ChatCompletionRequest.builder()
               .model("seed-2-0-lite-260228")//Replace with Model ID
               .messages(messages)
               .stream(true)
               .thinking(new ChatCompletionRequest.ChatCompletionRequestThinking("disabled"))
               .build();
        service.streamChatCompletion(chatCompletionRequest)
               .doOnError(Throwable::printStackTrace) // Handle errors
               .blockingForEach(response -> {
                    if (response.getChoices() != null && !response.getChoices().isEmpty()) {
                        String content = String.valueOf(response.getChoices().get(0).getMessage().getContent());
                        if (content != null) {
                            System.out.print(content); // Caution: Use print instead of println to keep the content continuous
                        }
                    }
                });
        // Shut down the service.
        service.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="PVxvcD9Vzm" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
import os
from openai import OpenAI

client = OpenAI(
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.environ.get("ARK_API_KEY"), 
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3",
    )

completion = client.chat.completions.create(
    #Replace with Model ID
    model = "seed-2-0-lite-260228",
    messages=[
        {"role": "user", "content": "What are some common cruciferous plants?"},
    ],
    stream=True,
)

# Ensure the connection is closed automatically to prevent connection leaks.
with completion: 
    for chunk in completion:
        if chunk.choices[0].delta.content is not None:
            print(chunk.choices[0].delta.content, end="")
```



</Tab>
</Tabs>



* Responses API sample code:



<Tabs>
<Tab zoneid="AtNQeyXcsl" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
      "model": "seed-2-0-lite-260228",
      "input": "What are the common cruciferous plants?",
      "stream": true
  }'
```



</Tab>
<Tab zoneid="Qd8yur7no3" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
from byteplussdkarkruntime import Ark
from byteplussdkarkruntime.types.responses.response_completed_event import ResponseCompletedEvent
from byteplussdkarkruntime.types.responses.response_reasoning_summary_text_delta_event import ResponseReasoningSummaryTextDeltaEvent
from byteplussdkarkruntime.types.responses.response_output_item_added_event import ResponseOutputItemAddedEvent
from byteplussdkarkruntime.types.responses.response_text_delta_event import ResponseTextDeltaEvent
from byteplussdkarkruntime.types.responses.response_text_done_event import ResponseTextDoneEvent

# Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
api_key = os.getenv('ARK_API_KEY')

client = Ark(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

# Create a request
response = client.responses.create(
    model="seed-2-0-lite-260228",
    input="What are the common cruciferous plants?",
    stream=True
)

for event in response:
    if isinstance(event, ResponseReasoningSummaryTextDeltaEvent):
        print(event.delta, end="")
    if isinstance(event, ResponseOutputItemAddedEvent):
        print("\\noutPutItem " + event.type + " start:")
    if isinstance(event, ResponseTextDeltaEvent):
        print(event.delta,end="")
    if isinstance(event, ResponseTextDoneEvent):
        print("\\noutPutTextDone.")
    if isinstance(event, ResponseCompletedEvent):
        print("Response Completed. Usage = " + event.response.usage.model_dump_json())
```



</Tab>
<Tab zoneid="IMzqCVNyj7" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "io"
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

    resp, err := client.CreateResponsesStream(ctx, &responses.ResponsesRequest{
        Model:    "seed-2-0-lite-260228",
        Input:    &responses.ResponsesInput{Union: &responses.ResponsesInput_StringValue{StringValue: "What are the common cruciferous plants?"}},
    })
    if err != nil {
        fmt.Printf("stream error: %v", err)
        return
    }
    for {
        event, err := resp.Recv()
        if err == io.EOF {
            break
        }
        if err != nil {
            fmt.Printf("stream error: %v", err)
            return
        }
        handleEvent(event)
    }
}
func handleEvent(event *responses.Event) {
    switch event.GetEventType() {
    case responses.EventType_response_reasoning_summary_text_delta.String():
        print(event.GetReasoningText().GetDelta())
    case responses.EventType_response_reasoning_summary_text_done.String(): // aggregated reasoning text
        fmt.Printf("\\nAggregated reasoning text: %s\\n", event.GetReasoningTextDone().GetText())
    case responses.EventType_response_output_text_delta.String():
        print(event.GetText().GetDelta())
    case responses.EventType_response_output_text_done.String(): // aggregated output text
        fmt.Printf("\\nAggregated output text: %s\\n", event.GetTextDone().GetText())
    default:
        return
    }
}
```



</Tab>
<Tab zoneid="Sgszxnwrnd" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.example;
import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.model.responses.request.*;
import com.byteplus.ark.runtime.model.responses.response.ResponseObject;
import com.byteplus.ark.runtime.model.responses.constant.ResponsesConstants;
import com.byteplus.ark.runtime.model.responses.common.ResponsesThinking;
import com.byteplus.ark.runtime.model.responses.event.functioncall.FunctionCallArgumentsDoneEvent;
import com.byteplus.ark.runtime.model.responses.event.outputitem.OutputItemAddedEvent;
import com.byteplus.ark.runtime.model.responses.event.outputitem.OutputItemDoneEvent;
import com.byteplus.ark.runtime.model.responses.event.outputtext.OutputTextDeltaEvent;
import com.byteplus.ark.runtime.model.responses.event.outputtext.OutputTextDoneEvent;
import com.byteplus.ark.runtime.model.responses.event.reasoningsummary.ReasoningSummaryTextDeltaEvent;
import com.byteplus.ark.runtime.model.responses.event.response.ResponseCompletedEvent;

public class demo {
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        //The base URL for model invocation
        ArkService arkService = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .stream(true)
                .input(ResponsesInput.builder().stringValue("What are the common cruciferous plants?").build())
                .build();
        arkService.streamResponse(request)
            .doOnError(Throwable::printStackTrace)
            .blockingForEach(event -> {
                if (event instanceof ReasoningSummaryTextDeltaEvent) {
                    System.out.print(((ReasoningSummaryTextDeltaEvent) event).getDelta());
                }
                if (event instanceof OutputItemAddedEvent) {
                    System.out.println("OutputItem " + (((OutputItemAddedEvent) event).getItem().getType()) + " Start: ");
                }
                if (event instanceof OutputTextDeltaEvent) {
                    System.out.print(((OutputTextDeltaEvent) event).getDelta());
                }
                if (event instanceof OutputTextDoneEvent) {
                    System.out.println("OutputText End.");
                }
                if (event instanceof OutputItemDoneEvent) {
                    System.out.println("OutputItem " + ((OutputItemDoneEvent) event).getItem().getType() + " End.");
                }
                if (event instanceof FunctionCallArgumentsDoneEvent) {
                    System.out.println("FunctionCall Arguments: " + ((FunctionCallArgumentsDoneEvent) event).getArguments());
                }
                if (event instanceof ResponseCompletedEvent) {
                    System.out.println("Response Completed. Usage = " + ((ResponseCompletedEvent) event).getResponse().getUsage());
                }
            });
    
        arkService.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="R27LBXcVa0" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
import os
from openai import OpenAI

# Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
api_key = os.getenv('ARK_API_KEY')

client = OpenAI(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

# Create a request
response = client.responses.create(
    model="seed-2-0-lite-260228",
    input="What are the common cruciferous plants?",
    stream=True
)

for event in response:
    if event.type == "response.reasoning_summary_text.delta":
        print(event.delta, end="")
    if event.type == "response.output_item.added":
        print("\\noutPutItem " + event.type + " start:")
    if event.type == "response.output_text.delta":
        print(event.delta,end="")
    if event.type == "response.output_item.done":
        print("\\noutPutTextDone.")
    if event.type == "response.completed":
        print("\\nResponse Completed. Usage = " + event.response.usage.model_dump_json())
```



</Tab>
</Tabs>


<span id="70213630"></span>
## Example response

Streaming responses are implemented based on the **Server\-Sent Events (SSE)**  protocol, whose core is that the server continuously pushes data chunks to the client via a persistent HTTP connection.

Each data chunk is composed of **field lines**. This includes model reasoning content chunks, reply content chunks, tool invocation chunks, and more. When the streaming response ends, the server pushes a special chunk, usually containing `data: [DONE]`


<Tabs>
<Tab zoneid="K4nlkDtKri" title="Chat API">
<TabTitle>Chat API</TabTitle>

```JSON
data: {"choices":[{"delta":{"content":"","reasoning_content":"\n","role":"assistant"},"index":0}],"created":1765713048,"id":"021765713047481dd742fe08f96381a9e3cd447cf1b9ac3192379","model":"seed-1-6-250915","service_tier":"default","object":"chat.completion.chunk","usage":null}
data: {"choices":[{"delta":{"content":"","reasoning_content":"user","role":"assistant"},"index":0}],"created":1765713048,"id":"021765713047481dd742fe08f96381a9e3cd447cf1b9ac3192379","model":"seed-1-6-250915","service_tier":"default","object":"chat.completion.chunk","usage":null}
...
data: {"choices":[{"delta":{"content":"","reasoning_content":".","role":"assistant"},"index":0}],"created":1765713048,"id":"021765713047481dd742fe08f96381a9e3cd447cf1b9ac3192379","model":"seed-1-6-250915","service_tier":"default","object":"chat.completion.chunk","usage":null}
data: {"choices":[{"delta":{"content":"You","role":"assistant"},"index":0}],"created":1765713048,"id":"021765713047481dd742fe08f96381a9e3cd447cf1b9ac3192379","model":"seed-1-6-250915","service_tier":"default","object":"chat.completion.chunk","usage":null}
data: {"choices":[{"delta":{"content":"✧","role":"assistant"},"index":0}],"created":1765713048,"id":"021765713047481dd742fe08f96381a9e3cd447cf1b9ac3192379","model":"seed-1-6-250915","service_tier":"default","object":"chat.completion.chunk","usage":null}
...
data: {"choices":[{"delta":{"content":"","role":"assistant"},"finish_reason":"stop","index":0}],"created":1765713048,"id":"021765713047481dd742fe08f96381a9e3cd447cf1b9ac3192379","model":"seed-1-6-250915","service_tier":"default","object":"chat.completion.chunk","usage":null}
data: [DONE]
```


Response format instructions: (For specific fields, see [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384))


* `choices[0].delta.content`: The message content generated by the model.

* `choices[0].delta.reasoning_content`: The model's reasoning content (CoT).

* `choices[0].finish_reason`: The reason the model stops generating tokens. (Appears only in the last chunk)


</Tab>
<Tab zoneid="VTAQMHauCc" title="Responses API">
<TabTitle>Responses API</TabTitle>

```JSON
event: response.created
data: {"type":"response.created","response":{"created_at":1764229579,"id":"resp_021764229578658fe9a0f6cb2cc6c828e7a59adbdb971872aee70","max_output_tokens":32768,"model":"seed-1-6-250915","object":"response","thinking":{"type":"enabled"},"service_tier":"default","caching":{"type":"disabled"},"store":true,"expire_at":1764488778},"sequence_number":0}

event: response.in_progress
data: {"type":"response.in_progress","response":{"created_at":1764229579,"id":"resp_021764229578658fe9a0f6cb2cc6c828e7a59adbdb971872aee70","max_output_tokens":32768,"model":"seed-1-6-250915","object":"response","thinking":{"type":"enabled"},"service_tier":"default","caching":{"type":"disabled"},"store":true,"expire_at":1764488778},"sequence_number":1}

event: response.output_item.added
data: {"type":"response.output_item.added","output_index":0,"item":{"id":"rs_02176422957963700000000000000000000ffffac15dd335c9c43","type":"reasoning","status":"in_progress"},"sequence_number":2}

event: response.reasoning_summary_part.added
data: {"type":"response.reasoning_summary_part.added","item_id":"rs_02176422957963700000000000000000000ffffac15dd335c9c43","output_index":0,"summary_index":0,"part":{"type":"summary_text"},"sequence_number":3}

event: response.reasoning_summary_text.delta
data: {"type":"response.reasoning_summary_text.delta","summary_index":0,"delta":"\n","item_id":"rs_02176422957963700000000000000000000ffffac15dd335c9c43","output_index":0,"sequence_number":4}
...
event: response.completed
data: {"type":"response.completed","response":{"created_at":1768809358,"id":"resp_021768809358289649f4507e5505b181d56acee99f33e5a9f1075","max_output_tokens":32768,"model":"seed-1-6-250915","object":"response","output":[{"id":"rs_02176880935899200000000000000000000ffffac154346d65c7e","type":"reasoning","summary":[{"type":"summary_text","text":"\n...。"}],"status":"completed"},{"type":"message","role":"assistant","content":[{"type":"output_text","text":"..."}],"status":"completed","id":"msg_02176880937345100000000000000000000ffffac154346bd6748"}],"service_tier":"default","status":"completed","usage":{"input_tokens":42,"output_tokens":846,"total_tokens":888,"input_tokens_details":{"cached_tokens":0},"output_tokens_details":{"reasoning_tokens":408}},"caching":{"type":"disabled"},"store":true,"expire_at":1769068558},"sequence_number":851}

data: [DONE]
```


Sample response instructions: (For specific fields, see [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request))


* event type `response.reasoning_summary_text.delta`, `event.delta` is the model's reasoning content.

* event type `response.output_text.delta`, `event.delta` is the message content generated by the model.

* event type `response.completed`, `event.response.usage` is the token usage for this request.


</Tab>
</Tabs>


<span id="e3f9c7c9"></span>
# APIs


* [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384)

* [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)


<span id="6a2d9c11"></span>
# More examples


* For how to enable streaming output in function calling, see [Support for streaming output](https://docs.byteplus.com/en/docs/ModelArk/1262342#ba983529).




