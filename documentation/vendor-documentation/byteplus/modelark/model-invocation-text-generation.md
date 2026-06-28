Generate coherent and clear text content based on the prompt.

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">If you're new to ModelArk, see <a href="https://docs.byteplus.com/en/docs/ModelArk/1399008">Quick start</a> to get up and running quickly.</div>


<span id="18cf565a"></span>
# Quick start


|Input |Output preview |
|---|---|
|```Plaintext```<br>```Please structure the following content: ModelArk is a large model service platform launched by BytePlus. It provides comprehensive functions and services such as model training, inference, evaluation, and fine-tuning, and focuses on supporting the large model ecosystem. Through stable and reliable secure mutual trust solutions, ModelArk ensures the model security of model providers and the information security of model users, accelerates the adoption of large model capabilities across industries, and helps model providers and users achieve new business growth.```<br> |```Plaintext```<br>```# Structured information about the ModelArk large model service platform```<br>``````<br>```## I. Basic attributes```<br>```1. **Launched by**: BytePlus```<br>```2. **Platform positioning**: Large model service platform```<br>``````<br>```## II. Core functions and services```<br>```Provides comprehensive large model-related functions and services such as model training, inference, evaluation, and fine-tuning. Core positioning includes:```<br>```1.  Support large model ecosystem development```<br>```2.  Promote the adoption of large model capabilities across industries```<br>``````<br>```## III. Security assurance solution```<br>```Provides two-way information security protection through stable and reliable secure mutual trust solutions:```<br>```1.  Model providers: The platform ensures the security of their models```<br>```2.  Model users: The platform ensures the security of their information```<br>``````<br>```## IV. Value goals```<br>```Help model providers and users achieve new business growth and build a win-win business model in the large model ecosystem.```<br> |



<Tabs>
<Tab zoneid="FjaP79kapX" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -d '{
    "model": "seed-2-0-lite-260228",
    "messages": [
        {"role": "user", "content": "Please structurally organize the following content: ModelArk is a large model service platform launched by BytePlus. It provides comprehensive functions and services such as model training, inference, evaluation, and fine-tuning, and focuses on supporting the large model ecosystem. Through stable and reliable secure mutual trust solutions, ModelArk ensures the model security of model providers and the information security of model users, accelerates the penetration of large model capabilities into various industries, and helps model providers and users achieve new business growth."}
    ],
     "thinking":{
         "type":"disabled"
     }
  }'
```



* Replace the model ID as needed. To query the model ID, see [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310).


</Tab>
<Tab zoneid="VxciuILGpg" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
# Install SDK:  pip install byteplus-python-sdk-v2
from byteplussdkarkruntime import Ark 

# Initialize the Ark client
client = Ark(
    # The base URL for model invocation
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key:https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
)

completion = client.chat.completions.create(
    # Replace with Model ID
    model = "seed-2-0-lite-260228",
    messages=[
        {"role": "user", "content": "Please structurally organize the following content: ModelArk is a large model service platform launched by BytePlus. It provides comprehensive functions and services such as model training, inference, evaluation, and fine-tuning, and focuses on supporting the large model ecosystem. Through stable and reliable secure mutual trust solutions, ModelArk ensures the model security of model providers and the information security of model users, accelerates the penetration of large model capabilities into various industries, and helps model providers and users achieve new business growth."}
    ],
    # thinking={"type": "disabled"}, #  Manually disable deep thinking
)
print(completion.choices[0].message.content)
```



</Tab>
<Tab zoneid="Vj8hyIwQGb" title="Go">
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
        // The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    
    ctx := context.Background()
    req := model.CreateChatCompletionRequest{
        // Replace with Model ID
       Model: "seed-2-0-lite-260228",
       Messages: []*model.ChatCompletionMessage{
          {
             Role: model.ChatMessageRoleUser,
             Content: &model.ChatCompletionMessageContent{
                StringValue: byteplus.String("Please structurally organize the following content: ModelArk is a large model service platform launched by BytePlus. It provides comprehensive functions and services such as model training, inference, evaluation, and fine-tuning, and focuses on supporting the large model ecosystem. Through stable and reliable secure mutual trust solutions, ModelArk ensures the model security of model providers and the information security of model users, accelerates the penetration of large model capabilities into various industries, and helps model providers and users achieve new business growth."),
             },
          },
       },
       Thinking: &model.Thinking{
            Type: model.ThinkingTypeDisabled, // Manually disable deep thinking
            // Type: model.ThinkingTypeEnabled, // Manually enable deep thinking
        },
    }

    resp, err := client.CreateChatCompletion(ctx, req)
    if err != nil {
       fmt.Printf("standard chat error: %v\n", err)
       return
    }
    fmt.Println(*resp.Choices[0].Message.Content.StringValue)
}
```



</Tab>
<Tab zoneid="xZcsjOgKAO" title="Java">
<TabTitle>Java</TabTitle>

```java
package com.ark.sample;

import com.byteplus.ark.runtime.model.completion.chat.*;
import com.byteplus.ark.runtime.service.ArkService;
import java.util.ArrayList;
import java.util.List;

public class ChatCompletionsExample {
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        // The base URL for model invocation
        ArkService service = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();
        final List<ChatMessage> messages = new ArrayList<>();
        final ChatMessage userMessage = ChatMessage.builder().role(ChatMessageRole.USER).content("Please structurally organize the following content: ModelArk is a large model service platform launched by BytePlus. It provides comprehensive functions and services such as model training, inference, evaluation, and fine-tuning, and focuses on supporting the large model ecosystem. Through stable and reliable secure mutual trust solutions, ModelArk ensures the model security of model providers and the information security of model users, accelerates the penetration of large model capabilities into various industries, and helps model providers and users achieve new business growth.").build();
        messages.add(userMessage);

        ChatCompletionRequest chatCompletionRequest = ChatCompletionRequest.builder()
               .model("seed-2-0-lite-260228")//Replace with Model ID
               .messages(messages)
               // .thinking(new ChatCompletionRequest.ChatCompletionRequestThinking("disabled")) // Manually disable deep thinking
               .build();
        service.createChatCompletion(chatCompletionRequest).getChoices().forEach(choice -> System.out.println(choice.getMessage().getContent()));
        // shutdown service
        service.shutdownExecutor();
    }
}
```



</Tab>
</Tabs>


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">For an example of using the Responses API to implement a single\-turn conversation, see <a href="https://docs.byteplus.com/en/docs/ModelArk/1958520#17377051">Quick start</a>.</div>


<span id="3e5edc90"></span>
# Models and APIs

Supported models: [Text generation](https://docs.byteplus.com/en/docs/ModelArk/1330310#b318deb2)

Supported APIs:


* [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request): A newly launched API with simplified context management, enhanced tool calling capabilities, and caching capabilities to reduce costs. Recommended for new businesses and users.

* [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384): A widely used API with low migration costs for existing businesses.


<span id="1d866118"></span>
# Usage examples

<span id="f6222fec"></span>
## Multi\-turn conversation

To implement a multi\-turn conversation, combine the conversation history that includes system messages, assistant messages, and user messages into a list, so that the model can understand the context and continue the previous topic for Q&A.


|Input method |Manage context manually |Manage context by ID |
|---|---|---|
|Example |```JSON```<br>```...```<br>```    "model": "seed-2-0-lite-260228",```<br>```    "messages":[```<br>```        {"role": "user", "content": "Hi, tell a joke."},```<br>```        {"role": "assistant", "content": "Why did the math book look sad? Because it had too many problems! 😄"},```<br>```        {"role": "user", "content": "What's the punchline of this joke?"}```<br>```    ]```<br>```...```<br> |```JSON```<br>```...```<br>```    "model": "seed-2-0-lite-260228",```<br>```    "previous_response_id":"<id>",```<br>```    "input": "What is the punchline of this joke?"```<br>```...```<br> |
|API |[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request) |


> For more information and complete examples, see [Context management](https://docs.byteplus.com/en/docs/ModelArk/2123288).


<span id="78d5cc11"></span>
## Streaming output


|Demo |Advantages |
|---|---|
|<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/0b0ed47ec1b94b20a4f4966aa80130e6" controls></video><br> |* **Improved waiting experience**: You can process in\-progress content immediately without waiting for the full content to be generated.<br><br>* **Real\-time feedback**: In multi\-turn interactions, you can track the current processing stage of the task in real time.<br><br>* **Higher fault tolerance**: If an error occurs midway, you can still obtain the generated content, avoiding the case where non\-streaming output fails and returns nothing.<br><br>* **Simplified timeout management**: Keeps the client–server connection active and reduces timeouts for long\-running or complex tasks. |


Enable streaming output by setting **stream** to `true`.

```JSON
...
    "model": "seed-2-0-lite-260228",
    "messages": [
        {"role": "user", "content": "Differences between deep reasoning models and non-deep reasoning models"}
    ],
    "stream": true
 ...
```


> For complete examples and more information, see [Streaming output](https://docs.byteplus.com/en/docs/ModelArk/2123275).


<span id="3821b26a"></span>
## Set maximum response length

To control costs or response time, you can limit the model's response length. When the response is long, such as when translating long text, you can set `max_tokens` to a larger value to avoid truncation.

```JSON
...
    "model": "seed-2-0-lite-260228",
    "messages": [
        {"role": "user","content": "What are some common cruciferous plants?"}
    ],
    "max_tokens": 300
...
```


> For the complete code sample, see [Control answer length](https://docs.byteplus.com/en/docs/ModelArk/2123288#c7fbdbe3).


<span id="8783d86f"></span>
## Asynchronous output

For complex tasks or scenarios with multiple concurrent tasks, you can use the Asyncio API to make concurrent calls, improving program efficiency and user experience.


* Chat API code sample:

   
   <Tabs>
   <Tab zoneid="TVR7SeqFfD" title="Python">
   <TabTitle>Python</TabTitle>
   
   ```Python
   import asyncio
   import os
   # Install SDK:  pip install byteplus-python-sdk-v2
       from byteplussdkarkruntime import AsyncArk
   
   # Initialize the Ark client
   client = AsyncArk(
       # The base URL for model invocation
       base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
       # Get API Key:https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey 
       api_key=os.getenv('ARK_API_KEY'), 
   )
   
   async def main() -> None:
       stream = await client.chat.completions.create(  
           # Replace with Model ID
           model = "seed-2-0-lite-260228",
           messages=[
               {"role": "system", "content": "You are an AI assistant."},
               {"role": "user", "content": "What are common cruciferous plants?"},
           ],
           stream=True
       )
       async for completion in stream:
           print(completion.choices[0].delta.content, end="")
       print()
       
   if __name__ == "__main__":
       asyncio.run(main())
   ```
   
   
   
   </Tab>
   </Tabs>
   

* Responses API code sample:

   
   <Tabs>
   <Tab zoneid="P3JXss9b55" title="Python">
   <TabTitle>Python</TabTitle>
   
   ```Python
   import asyncio
   import os
   from byteplussdkarkruntime import AsyncArk
   from byteplussdkarkruntime.types.responses.response_completed_event import ResponseCompletedEvent
   from byteplussdkarkruntime.types.responses.response_reasoning_summary_text_delta_event import ResponseReasoningSummaryTextDeltaEvent
   from byteplussdkarkruntime.types.responses.response_output_item_added_event import ResponseOutputItemAddedEvent
   from byteplussdkarkruntime.types.responses.response_text_delta_event import ResponseTextDeltaEvent
   from byteplussdkarkruntime.types.responses.response_text_done_event import ResponseTextDoneEvent
   
   
   client = AsyncArk(
       base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
       api_key=os.getenv('ARK_API_KEY')
   )
   
   async def main():
       stream = await client.responses.create(
           model="seed-2-0-lite-260228",
           input=[
               {"role": "system", "content": "You are an AI assistant."},
               {"role": "user", "content": "What are common cruciferous plants?"},
           ],
           stream=True
       )
       async for event in stream:
           if isinstance(event, ResponseReasoningSummaryTextDeltaEvent):
               print(event.delta, end="")
           if isinstance(event, ResponseOutputItemAddedEvent):
               print("\noutPutItem " + event.type + " start:")
           if isinstance(event, ResponseTextDeltaEvent):
               print(event.delta,end="")
           if isinstance(event, ResponseTextDoneEvent):
               print("\noutPutTextDone.")
           if isinstance(event, ResponseCompletedEvent):
               print("Response Completed. Usage = " + event.response.usage.model_dump_json())
   
   
   if __name__ == "__main__":
       asyncio.run(main())
   ```
   
   
   
   </Tab>
   </Tabs>
   


<span id="10b8a01c"></span>
# More usage

<span id="a1d6b42a"></span>
## Deep reasoning

Before generating a response, the model first conducts systematic analysis and logical decomposition of the input question, then generates the response based on the decomposition results.

This can significantly improve response quality, but increases token consumption. For details, see [Deep reasoning](https://docs.byteplus.com/en/docs/ModelArk/1449737).

<span id="19b5e705"></span>
## Prompt engineering

Designing and writing prompts correctly, such as providing instructions, examples, and good specifications, can improve the quality and accuracy of model output. The work of optimizing prompts is also called prompt engineering. For details, see [Prompt engineering](https://docs.byteplus.com/en/docs/ModelArk/1221660).

<span id="39a7195c"></span>
## Tool calling

By integrating built\-in tools or connecting to remote MCP servers, you can extend the model's capabilities to better answer questions or perform tasks. Currently supported:


* Calling custom functions.

* Access to third\-party MCP services.


<span id="8d0362b6"></span>
## Prefill\-based response

By prefilling part of the **assistant** role's content, you can guide and control the model to continue generating from existing text chunks, and control the model to maintain consistency in role\-playing scenarios.


* [Prefill-based response](https://docs.byteplus.com/en/docs/ModelArk/1359497): Use [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) to implement prefill\-based response.

* [Prefill-based response](https://docs.byteplus.com/en/docs/ModelArk/1958520#a1384090): Use [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request) to implement prefill\-based response.


<span id="c22bed1a"></span>
## Structured output (beta)

Control the model to output standard formats that programs can process (mainly JSON) instead of natural language, making standardized processing or display easier.


* [Structured output (beta)](https://docs.byteplus.com/en/docs/ModelArk/1568221): Use [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) to implement structured output.

* [Structured output (beta)](https://docs.byteplus.com/en/docs/ModelArk/1568221): Use [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request) to implement structured output.


<span id="4f8038b1"></span>
## Batch inference

ModelArk provides batch inference capabilities. When you have large\-scale data processing tasks, you can use batch inference to achieve higher throughput and lower costs. For details and usage, see [Batch inference](https://docs.byteplus.com/en/docs/ModelArk/1399517).

<span id="3b458a44"></span>
## Exception handling

Add exception handling for diagnosis.


<Tabs>
<Tab zoneid="U2UnHWtm93" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
# Install SDK:  pip install byteplus-python-sdk-v2
from byteplussdkarkruntime import Ark
from byteplussdkarkruntime._exceptions import ArkAPIError

# Initialize the Ark client
client = Ark(
    # The base URL for model invocation
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3",    
    api_key=os.getenv('ARK_API_KEY'), 
)

# Streaming
try:
    stream = client.chat.completions.create(
    # Replace with Model ID
    model = "seed-2-0-lite-260228",
        messages=[
            {"role": "system", "content": "You are an AI assistant."},
            {"role": "user", "content": "What are common cruciferous plants?"},
        ],
        stream=True
    )
    for chunk in stream:
        if not chunk.choices:
            continue

        print(chunk.choices[0].delta.content, end="")
    print()
except ArkAPIError as e:
    print(e)
```



</Tab>
<Tab zoneid="zvQIjSPsSk" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "errors"
    "fmt"
    "io"
    "os"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        // The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    ctx := context.Background()

    fmt.Println("----- streaming request -----")
    req := model.CreateChatCompletionRequest{
        // Replace with Model ID
       Model: "seed-2-0-lite-260228",
       Messages: []*model.ChatCompletionMessage{
          {
             Role: model.ChatMessageRoleSystem,
             Content: &model.ChatCompletionMessageContent{
                StringValue: byteplus.String("You are an AI assistant."),
             },
          },
          {
             Role: model.ChatMessageRoleUser,
             Content: &model.ChatCompletionMessageContent{
                StringValue: byteplus.String("What are common cruciferous plants?"),
             },
          },
       },
    }
    stream, err := client.CreateChatCompletionStream(ctx, req)
    if err != nil {
       apiErr := &model.APIError{}
       if errors.As(err, &apiErr) {
          fmt.Printf("stream chat error: %v\n", apiErr)
       }
       return
    }
    defer stream.Close()

    for {
       recv, err := stream.Recv()
       if err == io.EOF {
          return
       }
       if err != nil {
          apiErr := &model.APIError{}
          if errors.As(err, &apiErr) {
             fmt.Printf("stream chat error: %v\n", apiErr)
          }
          return
       }

       if len(recv.Choices) > 0 {
          fmt.Print(recv.Choices[0].Delta.Content)
       }
    }
}
```



</Tab>
<Tab zoneid="tLprEnmO6Z" title="Java">
<TabTitle>Java</TabTitle>

```java
package com.byteplus.ark.runtime;

import com.byteplus.ark.runtime.exception.ArkHttpException;
import com.byteplus.ark.runtime.model.completion.chat.ChatCompletionRequest;
import com.byteplus.ark.runtime.model.completion.chat.ChatMessage;
import com.byteplus.ark.runtime.model.completion.chat.ChatMessageRole;
import com.byteplus.ark.runtime.service.ArkService;
import java.util.ArrayList;
import java.util.List;


public class ChatCompletionsExample {
    public static void main(String[] args) {

        String apiKey = System.getenv("ARK_API_KEY");
        // The base URL for model invocation
        ArkService service = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

        System.out.println("----- streaming request -----");
        final List<ChatMessage> streamMessages = new ArrayList<>();
        final ChatMessage streamSystemMessage = ChatMessage.builder().role(ChatMessageRole.SYSTEM).content("You are an AI assistant.").build();
        final ChatMessage streamUserMessage = ChatMessage.builder().role(ChatMessageRole.USER).content("What are common cruciferous plants?").build();
        streamMessages.add(streamSystemMessage);
        streamMessages.add(streamUserMessage);

        ChatCompletionRequest streamChatCompletionRequest = ChatCompletionRequest.builder()
               .model("seed-2-0-lite-260228")//Replace with Model ID
               .messages(streamMessages)
               .build();

        try {
            service.streamChatCompletion(streamChatCompletionRequest)
                   .doOnError(Throwable::printStackTrace)
                   .blockingForEach(
                            choice -> {
                                if (choice.getChoices().size() > 0) {
                                    System.out.print(choice.getChoices().get(0).getMessage().getContent());
                                }
                            }
                    );
        } catch (ArkHttpException e) {
            System.out.print(e.toString());
        }

        // shutdown service
        service.shutdownExecutor();
    }

}
```



</Tab>
</Tabs>


<span id="b411f06e"></span>
## Conversation encryption

In addition to default network\-layer encryption, ModelArk also provides free application\-layer encryption to offer stronger security protection for your inference session data. You only need to add one line of code to enable it. For the complete code sample, see [Data encryption](https://docs.byteplus.com/en/docs/ModelArk/1544136#23274b89). For more information about how it works, see [Inferential Session Data Application Layer Encryption Scheme](https://docs.byteplus.com/en/docs/ModelArk/1389905).

<span id="ca2551d7"></span>
# Instructions


* Key model limits:

   * Maximum context length (context window): The length of content that the model can process in a single request, including user input and model output, measured in tokens. If the content exceeds the maximum context length, it will be truncated and output will stop. If content is truncated due to the context limit, you can choose a model that supports a larger context length.

   * Maximum output length (max tokens): The maximum length of content that the model can output in a single request. If this happens, you can see [Prefill-based response](https://docs.byteplus.com/en/docs/ModelArk/1359497) and generate multiple continued responses to assemble the complete content.

   * Tokens processed per minute (TPM): The limit on the amount of content that the same model under an account (regardless of version) can process per minute, measured in tokens. If the default TPM limit cannot meet your business needs, you can contact support ([Ticket](https://console.byteplus.com/workorder/create?step=2&SubProductID=P00001514)) to increase the quota. Example: If a model's TPM is 5 million, all endpoint versions of this model created under the same primary account share this quota.

   * Requests processed per minute (RPM): The maximum number of requests that the same model under an account (regardless of version) can process per minute. This is similar to TPM above. If the default RPM limit cannot meet your business needs, you can contact support ([Ticket](https://console.byteplus.com/workorder/create?step=2&SubProductID=P00001514)) to increase the quota.

   * For detailed specification information about each model, see [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310).

* Usage query:

   * Token usage for a request: You can view it in the returned **usage** object.

   * Token usage for input/output content: You can use [Tokenization API](https://docs.byteplus.com/en/docs/ModelArk/tokenization) or [Token calculator](https://console.byteplus.com/ark/region:ark+ap-southeast-1/tokenCalculator) to estimate it.

   * Token usage by account/project/endpoint: You can view it on the [Usage](https://console.byteplus.com/ark/region:ark+ap-southeast-1/usageTracking) page.


<span id="901dd971"></span>
# FAQs

For FAQs about online inference, see [Online inference](https://docs.byteplus.com/en/docs/ModelArk/1359411#aa45e6c0). If you encounter an error, you can try to find a solution here.



