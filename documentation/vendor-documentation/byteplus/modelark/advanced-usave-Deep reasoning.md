Deep reasoning means that the model analyzes the problem and performs multi\-step planning before answering, and then tries to solve the problem. It is good at handling complex and abstract scenarios such as programming, scientific reasoning, and agent workflows. After deep reasoning is enabled, the chain\-of\-thought content is returned in the specified parameter, which you can use to observe and use the model's reasoning content.

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">If you're new to ModelArk, see <a href="https://docs.byteplus.com/en/docs/ModelArk/1399008">Quick start</a> to get up and running quickly.</div>


<span id="18cf565a"></span>
# Quick start

&nbsp;

<span id="5538fa9e"></span>
## Code samples


<Tabs>
<Tab zoneid="h012alf7HW" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -d '{
    "model": "seed-2-0-lite-260228",
    "messages": [
        {
            "role": "user",
            "content": "I want to study the differences between deep reasoning models and non-deep reasoning models. How can I demonstrate my expertise?"
        }
    ]
  }'
```



* Replace the Model ID as needed. To query the Model ID, see [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310).


</Tab>
<Tab zoneid="LMVt0lxekY" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
# Install SDK:  pip install byteplus-python-sdk-v2
from byteplussdkarkruntime import Ark 

client = Ark(
    # The base URL for model invocation
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3",
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
    # Deep thinking takes longer; set a larger timeout, with 1,800 seconds or more recommended
    timeout=1800,
)

completion = client.chat.completions.create(
    # Replace with Model ID
    model = "seed-2-0-lite-260228",
    messages=[
        {"role": "user", "content": "I want to study the differences between deep reasoning models and non-deep reasoning models. How can I demonstrate my expertise?"}
    ]
)
# When deep thinking is triggered, print the chain-of-thought content
if hasattr(completion.choices[0].message, 'reasoning_content'):
    print(completion.choices[0].message.reasoning_content)
print(completion.choices[0].message.content)
```



</Tab>
<Tab zoneid="gIdhTTfAFz" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    "time"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/volcengine"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        // Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
        os.Getenv("ARK_API_KEY"),
        // The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
        // Deep thinking takes longer; set a larger timeout, with 1,800 seconds or more recommended
        arkruntime.WithTimeout(30*time.Minute),
    )
    ctx := context.Background()
    req := model.CreateChatCompletionRequest{
        // Replace with Model ID
       Model: "seed-2-0-lite-260228",
        Messages: []*model.ChatCompletionMessage{
            {
                Role: model.ChatMessageRoleUser,
                Content: &model.ChatCompletionMessageContent{
                    StringValue: volcengine.String("I want to research the differences between deep reasoning models and non-deep reasoning models. How can I demonstrate my expertise?"),
                },
            },
        },
    }

    resp, err := client.CreateChatCompletion(ctx, req)
    if err != nil {
        fmt.Printf("standard chat error: %v\n", err)
        return
    }
    // When deep thinking is triggered, print the chain-of-thought content
    if resp.Choices[0].Message.ReasoningContent != nil {
        fmt.Println(*resp.Choices[0].Message.ReasoningContent)
    }
    fmt.Println(*resp.Choices[0].Message.Content.StringValue)
}
```



</Tab>
<Tab zoneid="vTW2vbZI3V" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.byteplus.ark.runtime.model.completion.chat.ChatCompletionContentPart;
import com.byteplus.ark.runtime.model.completion.chat.ChatCompletionRequest;
import com.byteplus.ark.runtime.model.completion.chat.ChatMessage;
import com.byteplus.ark.runtime.model.completion.chat.ChatMessageRole;
import com.byteplus.ark.runtime.service.ArkService;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.time.Duration;

public class ChatCompletionsExample {
    public static void main(String[] args) {
        // Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
        String apiKey = System.getenv("ARK_API_KEY");
        ArkService arkService = ArkService.builder()
                .apiKey(apiKey)
                .timeout(Duration.ofMinutes(30))// Deep thinking takes longer; set a larger timeout, with 1,800 seconds or more recommended
                .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3")// The base URL for model invocation
                .build();
        List<ChatMessage> chatMessages = new ArrayList<>();
        ChatMessage userMessage = ChatMessage.builder()
                .role(ChatMessageRole.USER)
                .content("I want to research the differences between deep reasoning models and non-deep reasoning models. How can I demonstrate my expertise?")
                .build();
        chatMessages.add(userMessage);
        ChatCompletionRequest chatCompletionRequest = ChatCompletionRequest.builder()
                .model("seed-2-0-lite-260228")//Replace with Model ID
                .messages(chatMessages)
                .build();
        try {
            arkService.createChatCompletion(chatCompletionRequest)
                    .getChoices()
                    .forEach(choice -> {                    
                        if (choice.getMessage().getReasoningContent() != null) {
                            System.out.println(choice.getMessage().getReasoningContent());
                        }
                        System.out.println(choice.getMessage().getContent());
                    });
        } catch (Exception e) {
            System.out.println(e.getMessage());
        } finally {
// Shut down the service executor
            arkService.shutdownExecutor();
        }
    }
}
```



</Tab>
<Tab zoneid="rJviflXC9c" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
import os
from openai import OpenAI

client = OpenAI(
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.environ.get("ARK_API_KEY"), 
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3",
    # Deep thinking takes longer; set a larger timeout, with 1,800 seconds or more recommended
    timeout=1800,
    )
completion = client.chat.completions.create(
    # Replace with Model ID
    model = "seed-2-0-lite-260228",
    messages=[
        {"role": "user", "content": "I want to study the differences between deep reasoning models and non-deep reasoning models. How can I demonstrate my expertise?"}
    ]
)
# When deep thinking is triggered, print the chain-of-thought content
if hasattr(completion.choices[0].message, 'reasoning_content'):
    print(completion.choices[0].message.reasoning_content)
print(completion.choices[0].message.content)
```



</Tab>
</Tabs>


<span id="14b5c6db"></span>
# Models and APIs

Supported models: [Deep reasoning](https://docs.byteplus.com/en/docs/ModelArk/1330310#898d064d).

Supported APIs:


* [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request): A newly launched API with simplified context management, enhanced tool calling capabilities, and caching capabilities to reduce costs. Recommended for new businesses and users.

* [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384): A widely used API with low migration costs for existing businesses.


<span id="7cf8f2eb"></span>
# Basic usage

<span id="774e488d"></span>
## Multi\-turn conversation

By combining system messages, model messages, and user messages, you can implement multi\-turn conversations. When you need to continue a conversation within one topic, you can pass the conversation history from previous turns to the model.


<span aceTableMode="list" aceTableWidth="1,5,5"></span>
|Input method |Manage context manually |Manage context by ID |
|---|---|---|
|Example |```JSON```<br>```...```<br>```    "model": "seed-2-0-lite-260228",```<br>```    "messages":[```<br>```        {"role": "user", "content": "Hi, tell a joke."},```<br>```        {"role": "assistant", "content": "Why did the math book look sad? Because it had too many problems! 😄"},```<br>```        {"role": "user", "content": "What's the punchline of this joke?"}```<br>```    ]```<br>```...```<br> |```JSON```<br>```...```<br>```    "model": "seed-2-0-lite-260228",```<br>```    "previous_response_id":"<id>",```<br>```    "input": "What is the punchline of this joke?"```<br>```...```<br> |
|API |[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request) |


> When building the context for a multi\-turn conversation:

> * Model versions before `251228`: Remove the **reasoning_content** parameter from the conversation history, and keep only `role` and `content`. ModelArk will try to ignore this parameter, but explicitly removing it ensures the request structure is correct.

> * `seed-1.8` and later models: Keep the **reasoning_content** parameter in the conversation history. The model determines whether to include this parameter in the inference input.

> For more information and complete examples, see [Context management](https://docs.byteplus.com/en/docs/ModelArk/2123288).


<span id="4ad2b076"></span>
## Streaming output

Content is output dynamically as the large model generates it. You can see intermediate output during the process without waiting for model inference to finish.


<span aceTableMode="list" aceTableWidth="1,2"></span>
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


<span id="fa3f44fa"></span>
## Enable/disable deep reasoning

The **thinking** parameter controls whether to enable or disable deep reasoning, enabling fine\-grained control: "use deep reasoning for complex tasks and respond efficiently to simple tasks", to reduce costs and improve efficiency.


* Valid values:

   * `enabled`: Force enable. Forcibly turn on the deep reasoning capability.

   * `disabled`: Force disable. Forcibly turn off the deep reasoning capability.

* Code samples:

   
   <Tabs>
   <Tab zoneid="CgJMZ6FYg4" title="Curl">
   <TabTitle>Curl</TabTitle>
   
   ```Bash
   curl https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $ARK_API_KEY" \
     -d '{
       "model": "seed-2-0-lite-260228",
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type":"text",
                        "text":"I want to research the differences between deep reasoning models and non-deep reasoning models, and demonstrate my professionalism"
                    }
                ]
            }
        ],
        "thinking":{
            "type":"disabled"
        }
   }'
   ```
   
   
   
      * **model**: Replace it with the model actually called.
   
      * **thinking.type**: valid values:
   
         * `disabled`: Force disables deep reasoning. The model does not output chain\-of\-thought content.
   
         * `enabled`: Force enables deep reasoning. The model is forced to output chain\-of\-thought content.
   
   
   </Tab>
   <Tab zoneid="dvNqkeNMAW" title="Python">
   <TabTitle>Python</TabTitle>
   
   ```Python
   import os
   # Install SDK:  pip install byteplus-python-sdk-v2
   from byteplussdkarkruntime import Ark 
   
   client = Ark(
       # The base URL for model invocation
       base_url="https://ark.ap-southeast.bytepluses.com/api/v3",
       # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
       api_key=os.getenv('ARK_API_KEY'), 
       # Deep thinking takes longer; set a larger timeout, with 1,800 seconds or more recommended
       timeout=1800,
   )
   
   # Create a chat request
   completion = client.chat.completions.create(
       # Replace with Model ID
       model = "seed-2-0-lite-260228",
       messages=[
           {"role": "user", "content": "I want to research a topic on the differences between deep reasoning models and non-deep reasoning models in a way that demonstrates my professionalism"}
       ],
        thinking={
            "type": "disabled", # Do not use deep reasoning
            # "type": "enabled", # Use deep reasoning
            },
   )
   
   print(completion)
   ```
   
   
   
   </Tab>
   <Tab zoneid="meeOCdLxyW" title="Go">
   <TabTitle>Go</TabTitle>
   
   ```Go
   package main
   
   import (
       "context"
       "fmt"
       "os"
       "time"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/volcengine"
   )
   
   func main() {
       client := arkruntime.NewClientWithApiKey(
           // Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
           os.Getenv("ARK_API_KEY"),
           // The base URL for model invocation
           arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
           //Deep reasoning takes longer; set a larger timeout, with 30 minutes or more recommended
           arkruntime.WithTimeout(30*time.Minute),
       )
       // Create a context, which is usually used to pass request context information such as timeout, cancellation, etc.
       ctx := context.Background()
       // Construct a chat completion request, and set the model and message content for the request
       req := model.CreateChatCompletionRequest{
           // Replace with Model ID
          Model: "seed-2-0-lite-260228",
          Messages: []*model.ChatCompletionMessage{
               {
                   // The message role is user
                   Role: model.ChatMessageRoleUser,
                   Content: &model.ChatCompletionMessageContent{
                       StringValue: volcengine.String("I want to research the differences between deep reasoning models and non-deep reasoning models. How can I demonstrate my expertise?"),
                   },
               },
           },
           Thinking: &model.Thinking{
               Type: model.ThinkingTypeDisabled, // Disable deep reasoning
               // Type: model.ThinkingTypeEnabled, // Enable deep reasoning
               },
       }
   
   
       // Send the chat completion request, store the result in resp, and store possible errors in err
       resp, err := client.CreateChatCompletion(ctx, req)
       if err != nil {
           // If an error occurs, print the error message and terminate the program
           fmt.Printf("standard chat error: %v\n", err)
           return
       }
       // Check whether deep reasoning is triggered. If triggered, print the chain-of-thought content
       if resp.Choices[0].Message.ReasoningContent != nil {
           fmt.Println(*resp.Choices[0].Message.ReasoningContent)
       }
       // Print the response result of the chat completion request
       fmt.Println(*resp.Choices[0].Message.Content.StringValue)
   }
   ```
   
   
   
   </Tab>
   <Tab zoneid="aq2wH6dms8" title="Java">
   <TabTitle>Java</TabTitle>
   
   ```Java
   package com.ark.sample;
   
   import com.byteplus.ark.runtime.model.completion.chat.*;
   import com.byteplus.ark.runtime.service.ArkService;
   import java.time.Duration;
   import java.util.ArrayList;
   import java.util.List;
   
   /**
    * This is an example class that demonstrates how to use ArkService to implement chat functionality.
    */
   public class ChatCompletionsExample {
       public static void main(String[] args) {
           // Get API key from environment variables
           String apiKey = System.getenv("ARK_API_KEY");
           // Create an ArkService instance
           ArkService arkService = ArkService.builder()
                   .apiKey(apiKey)
                   .timeout(Duration.ofMinutes(30))// Deep reasoning takes longer; set a larger timeout, with 30 minutes or more recommended
                   // The base URL for model invocation
                   .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3")
                   .build();
          // Initialize message list
           List<ChatMessage> chatMessages = new ArrayList<>();
   // Create user message
           ChatMessage userMessage = ChatMessage.builder()
                   .role(ChatMessageRole.USER) // Set message role to user
                   .content("I want to research the differences between deep reasoning models and non-deep reasoning models. How can I demonstrate my expertise?")// Set message content
                   .build();
   // Add user message to the message list
           chatMessages.add(userMessage);
           ChatCompletionRequest chatCompletionRequest = ChatCompletionRequest.builder()
                   .model("seed-2-0-lite-260228")//Replace with Model ID
                   .messages(chatMessages) // Set message list
                   .thinking(new ChatCompletionRequest.ChatCompletionRequestThinking("disabled"))
                   .build();
   // Send chat completion request and print response
           try {
   // Get response and print the message content of each choice
               arkService.createChatCompletion(chatCompletionRequest)
                       .getChoices()
                       .forEach(choice -> {                    
   // Check whether deep reasoning is triggered and print the chain-of-thought content
                           if (choice.getMessage().getReasoningContent() != null) {
                               System.out.println("Reasoning content: " + choice.getMessage().getReasoningContent());
                           } else {
                               System.out.println("Reasoning content is empty");
                           }
   // Print message content
                           System.out.println("Message content: " + choice.getMessage().getContent());
                       });
           } catch (Exception e) {
               System.out.println("Request failed: " + e.getMessage());
           } finally {
   // Shut down service executor
               arkService.shutdownExecutor();
           }
       }
   }
   ```
   
   
   
   </Tab>
   <Tab zoneid="b4bbKq5CwS" title="OpenAI SDK">
   <TabTitle>OpenAI SDK</TabTitle>
   
   ```Python
   import os
   from openai import OpenAI
   
   client = OpenAI(
       # Get ModelArk API Key from environment variables
       api_key=os.environ.get("ARK_API_KEY"), 
       base_url="https://ark.ap-southeast.bytepluses.com/api/v3",
       # Deep reasoning takes longer. To avoid failures caused by connection timeouts, set a larger timeout limit. 1800 seconds or more is recommended
       timeout=1800,
       )
   completion = client.chat.completions.create(
       # Replace with Model ID
       model = "seed-2-0-lite-260228",
       messages=[
           {
               "role": "user",
               "content": "I want to research the differences between deep reasoning models and non-deep reasoning models, and demonstrate my expertise",
           }
       ],
       extra_body={
           "thinking": {
               "type": "disabled",  # Do not use deep reasoning capabilities
               # "type": "enabled", # Use deep reasoning
               }
       },
   )
   
   
   print(completion)
   ```
   
   
   
   </Tab>
   </Tabs>
   

* Supported models:

   * deepseek\-v4\-pro\-260425: supports `enabled` (default) and `disabled`.

   * deepseek\-v4\-flash\-260425: supports `enabled` (default) and `disabled`.

   * seed\-2\-0\-lite\-260428: supports `enabled` (default) and `disabled`.

   * seed\-2\-0\-mini\-260428: supports `enabled` (default) and `disabled`.

   * seed\-2\-0\-pro\-260328: supports `enabled` (default) and `disabled`.

   * seed\-2\-0\-lite\-260228: supports `enabled` (default) and `disabled`.

   * seed\-2\-0\-mini\-260215: supports `enabled` (default) and `disabled`.

   * seed\-2\-0\-code\-preview\-260328: supports `enabled` (default) and `disabled`.

   * seed\-1\-8\-251228: supports `enabled` (default) and `disabled`.

   * seed\-1\-6\-250915: supports `enabled` (default) and `disabled`.

   * seed\-1\-6\-250615: supports `enabled` (default) and `disabled`.

   * seed\-1\-6\-flash\-250715: supports `enabled` (default) and `disabled`.

   * seed\-1\-6\-flash\-250615: supports `enabled` (default) and `disabled`.

   * gpt\-oss\-120b\-250805: supports `enabled` (default), `disabled`, and `auto`.

   * glm\-4\-7\-251222: supports `enabled` (default) and `disabled`.

   * deepseek\-v3\-2\-251201: supports `enabled` and `disabled` (default).

* More information

   * For instructions on using the Responses API, see [Control deep reasoning](https://docs.byteplus.com/en/docs/ModelArk/1956279#19c1bd32).

   * Deep reasoning affects prefill\-based response. For details, see [Prefill-based response](https://docs.byteplus.com/en/docs/ModelArk/1359497).


<span id="cfc7c5a8"></span>
## Set maximum output length

The model output consists of two parts: **Chain of Thought (COT)**  and **final answer (Answer)** . Control the model output length properly to balance quality, speed, cost, and stability.


<span aceTableMode="list" aceTableWidth="1,3,3"></span>
|Input method |Manage context manually |Manage context by ID |
|---|---|---|
|API |[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request) |
|Example |```JSON```<br>```...```<br>```    "model": "seed-2-0-lite-260228",```<br>```    "messages": [```<br>```        {"role": "user", "content": "Hi, tell a joke."}```<br>```    ],```<br>```    "max_completion_tokens": 300```<br>```...```<br> |```JSON```<br>```...```<br>```    "model": "seed-2-0-lite-260228",```<br>```    "previous_response_id":"<id>",```<br>```     "input": "Hi, tell a joke.",```<br>```     "max_output_tokens": 300```<br>```...```<br> |


> For complete examples and more information, see [Control output (answer + Chain of Thought) length](https://docs.byteplus.com/en/docs/ModelArk/2123288#3cb3d444).


<span id="fc5eac89"></span>
## Adjust chain\-of\-thought length

Use the **reasoning_effort** (Chat API) and **reasoning.effort** (Responses API) parameters to adjust the chain\-of\-thought length, balancing quality, latency, and cost requirements across scenarios. Valid values are:


* `minimal`: Turns off reasoning and answers directly.

* `low`: Light reasoning, focused on fast responses.

* `medium` (default): Balanced mode, considering both speed and depth.

* `high`: Deep analysis for handling complex problems.

* `max`: Maximum level of reasoning, suitable for highly difficult reasoning tasks. This option only works for specified models. It will not work if passed for unsupported models. Supported models for this option:

   * `deepseek-v4-pro-260425`

   * `deepseek-v4-flash-260425`



<span aceTableMode="list" aceTableWidth="1,3,3"></span>
|API |[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request) |
|---|---|---|
|Example |```JSON```<br>```...```<br>```    "model": "seed-2-0-lite-260228",```<br>```    "messages": [```<br>```        {"role": "user","content": "What are some common cruciferous plants?"}```<br>```    ],```<br>```    "reasoning_effort": "low"```<br>```...```<br> |```JSON```<br>```...```<br>```    "model": "seed-2-0-lite-260228",```<br>```    "input": [```<br>```        {"role": "user","content":"What are some common cruciferous plants?"}```<br>```    ],```<br>```    "reasoning":{"effort": "low"}```<br>```...```<br> |
|Supported models |* deepseek\-v4\-pro\-260425<br><br>* deepseek\-v4\-flash\-260425<br><br>* seed\-2\-0\-lite\-260428<br><br>* seed\-2\-0\-mini\-260428<br><br>* seed\-2\-0\-pro\-260328<br><br>* seed\-2\-0\-lite\-260228<br><br>* seed\-2\-0\-mini\-260215<br><br>* seed\-2\-0\-code\-preview\-260328<br><br>* seed\-1\-8\-251228 |* deepseek\-v4\-pro\-260425<br><br>* deepseek\-v4\-flash\-260425<br><br>* seed\-2\-0\-lite\-260428<br><br>* seed\-2\-0\-mini\-260428<br><br>* seed\-2\-0\-pro\-260328<br><br>* seed\-2\-0\-lite\-260228<br><br>* seed\-2\-0\-mini\-260215<br><br>* seed\-2\-0\-code\-preview\-260328<br><br>* seed\-1\-8\-251228 |


For the complete example and instructions, see [Control CoT length [New]](https://docs.byteplus.com/en/docs/ModelArk/2123288#480730d0).

<span id="3cf44d66"></span>
## Output thinking summary

<span id="fee31637"></span>
### Supported models


* seed\-2\-0\-lite\-260428

* seed\-2\-0\-mini\-260428

* seed\-2\-0\-pro\-260328

    &nbsp;


<span id="instructions"></span>
### Instructions

The thinking summary is enabled by default. When it is enabled, the summary of the model's thinking content (**choices.message.reasoning_content**) and the encrypted thinking content (**choices.message.encrypted_content**) will be returned instead of the thinking content.

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


> <div data-tips="true" data-tips-type="tip" data-wrapper-indent="0">When thinking summary is enabled, there may be relatively high inter\-packet latency. Please increase the request timeout period (<strong>timeout</strong>) and complete compatibility adaptation.</div>



Parameter explanation:


* **reasoning_effort**: Only applies to the original thinking content of the model, not to the thinking summary.

* **usage.completion_tokens_details.reasoning_tokens**: Tokens of the original thinking content. Billing is still calculated based on the tokens of the original thinking content.


<span id="b9e7f4ab"></span>
### Pass thinking content back

If you need to pass the thinking content back when calling tools, note the following: (For an example of passing thinking content back, see [Pass encrypted thinking content back](https://docs.byteplus.com/en/docs/ModelArk/1449737#8cfd447b).)


* Pass both **encrypted_content** and **reasoning_content**: **encrypted_content** has higher priority, and the content in **reasoning_content** will be ignored. The content of **encrypted_content** must be valid. If it is tampered with, it cannot be restored.

* Only pass **reasoning_content**: The thinking content summary is used for inference. In multi\-turn tool call scenarios (such as agent scenarios), if **encrypted_content** is not passed back, the model inference quality will be degraded.

* No parameters related to thinking content are passed back: No error will be reported.


<span id="3e8661f7"></span>
## Tool calling

Models earlier than seed\-1.8 will directly discard chain\-of\-thought content if deep thinking is enabled when tools are called. To provide more detailed and accurate responses, seed\-1.8 and some other models will not directly discard chain\-of\-thought content. The chain\-of\-thought content may participate in subsequent rounds of reasoning, which will increase input tokens. For details, see [How deep reasoning works](https://docs.byteplus.com/en/docs/ModelArk/1449737#e1e56b26).

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">It is recommended to use previous_response_id in Responses API, and then ModelArk automatically saves the historical conversation context and passes it back to the inference service during multi\-turn interactions.</div>


<span id="8cfd447b"></span>
### Pass encrypted thinking content back

Thinking summary is enabled by default for seed\-2\-0\-pro\-260328, seed\-2\-0\-mini\-260428, seed\-2\-0\-lite\-260428 and later versions, so they will not output the original thinking content. The following is an example of passing the encrypted thinking content back when tools are called. When using Responses API, it is recommended to use previous_response_id to automatically obtain the original thinking content and pass it back to the model for inference.


<span aceTableMode="list" aceTableWidth="1,5,5"></span>
|API |[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request) |
|---|---|---|
|Supported models and explanations |* [Supported models](https://docs.byteplus.com/en/docs/ModelArk/1449737#fee31637)<br><br>* [Pass thinking content back](https://docs.byteplus.com/en/docs/ModelArk/1449737#b9e7f4ab) |* [Supported models](https://docs.byteplus.com/en/docs/ModelArk/1956279#7e7354e3)<br><br>* [Pass thinking content back](https://docs.byteplus.com/en/docs/ModelArk/1956279#cde1bf53) |
|Example |**Request of round 1: Trigger tool calling**<br><br>```Bash```<br>```curl https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions \```<br>```  -H "Content-Type: application/json" \```<br>```  -H "Authorization: Bearer $ARK_API_KEY" \```<br>```  -d '{```<br>```    "model": "seed-2-0-lite-260228",```<br>```    "messages": [```<br>```        {```<br>```            "role": "system",```<br>``````<br>```            "content": "You are an AI assistant."```<br>```        },```<br>```        {```<br>```            "role": "user",```<br>``````<br>```            "content": "What is the weather like in Beijing today?"```<br>```        }```<br>```    ],```<br>```    "thinking":{"type": "enabled"},```<br>```    "tools": [```<br>```        {```<br>```            "type": "function",```<br>```            "function": {```<br>```                "name": "get_weather",```<br>``````<br>```                "description": "Weather query",```<br>```                "parameters": {```<br>```                    "properties": {```<br>```                        "location": {```<br>``````<br>```                            "description": "The location for which to query the weather.",```<br>```                            "type": "string"```<br>```                        }```<br>```                    },```<br>```                    "required": [```<br>```                        "location"```<br>```                    ],```<br>```                    "type": "object"```<br>```                }```<br>```            }```<br>```        }```<br>```    ]```<br>```  }'```<br><br><br>**Response of round 1: Return the tool call instruction**<br><br>The model returns key parameters such as `encrypted_content`, `reasoning_content`, and `tool_calls`.<br><br>```Bash```<br>```{```<br>```    "choices": [```<br>```        {```<br>```            "finish_reason": "tool_calls",```<br>```            "index": 0,```<br>```            "logprobs": null,```<br>```            "message": {```<br>```                "content": "",```<br>``````<br>```                "reasoning_content": "I will call the relevant tools to query the weather in Beijing.\n",```<br>```                "encrypted_content": "djF+2EICEj3ryfEfSUdR/SmS8OeEH4znOYftL4SWDXR8uxROjx11W7rRCj5ArLwzsm7rFsO4frOdLm2p3/yWz/r0TMqrjHiaTTvRMNdV6sLdETySlb3PDgY1W+zuYuETiq3bQuxga5jKx+GpfvlDJMfJfzq/G1kDp6ryurs0rKAFIziyc4mfFSh2CzDKNcAcp5Fi5R7M2QrSYmIUJjnoB48IVUCzu4xn7bT05qheVnGO9fbs15gYK3zINUvVsp51Oq72U/ksrPZFVs2BTgNRwjmxnFNn7A==",```<br>```                "role": "assistant",```<br>```                "tool_calls": [```<br>```                    {```<br>```                        "function": {```<br>``````<br>```                            "arguments": " {\"location\": \"Beijing\"}",```<br>```                            "name": "get_weather"```<br>```                        },```<br>```                        "id": "call_wiezxeyae8jzxl3jx8nhfgb5",```<br>```                        "type": "function"```<br>```                    }```<br>```                ]```<br>```            }```<br>```        }```<br>```    ],```<br>```    ...```<br>``` }```<br><br><br>**Request of round 2: Pass back the full context and generate the final response**<br><br>The following example shows the following process: based on the request of round 1, pass back the encrypted original thinking content (**encrypted_content**), thinking content summary (**reasoning_content**) and tool calling results, then the model generates a response in natural language.<br><br>```Bash```<br>```curl https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions \```<br>```  -H "Content-Type: application/json" \```<br>```  -H "Authorization: Bearer $ARK_API_KEY" \```<br>```  -d '{```<br>```    "model": "seed-2-0-lite-260228",```<br>```    "messages": [```<br>```        {```<br>```            "role": "system",```<br>``````<br>```            "content": "You are an AI assistant."```<br>```        },```<br>```        {```<br>```            "role": "user",```<br>``````<br>```            "content": "What is the weather like in Beijing today?"```<br>```        },```<br>```        {```<br>``````<br>```            "reasoning_content": "<the reasoning content from the previous request>"```<br>```            "encrypted_content": "djF+2EICEj3ryfEfSUdR/SmS8OeEH4znOYftL4SWDXR8uxROjx11W7rRCj5ArLwzsm7rFsO4frOdLm2p3/yWz/r0TMqrjHiaTTvRMNdV6sLdETySlb3PDgY1W+zuYuETiq3bQuxga5jKx+GpfvlDJMfJfzq/G1kDp6ryurs0rKAFIziyc4mfFSh2CzDKNcAcp5Fi5R7M2QrSYmIUJjnoB48IVUCzu4xn7bT05qheVnGO9fbs15gYK3zINUvVsp51Oq72U/ksrPZFVs2BTgNRwjmxnFNn7A==",```<br>```            "role": "assistant",```<br>```            "tool_calls": [```<br>```                {```<br>```                    "function": {```<br>``````<br>```                        "arguments": " {\"location\": \"Beijing\"}",```<br>```                        "name": "get_weather"```<br>```                    },```<br>```                    "id": "call_wiezxeyae8jzxl3jx8nhfgb5",```<br>```                    "type": "function"```<br>```                }```<br>```            ]```<br>```        },```<br>```        {```<br>```            "role": "tool",```<br>```            "tool_call_id":"call_wiezxeyae8jzxl3jx8nhfgb5",```<br>``````<br>```            "content": "5 degree"```<br>```        }```<br>```    ],```<br>```    "thinking":{"type": "enabled"},```<br>```    "tools": [```<br>```        {```<br>```            "type": "function",```<br>```            "function": {```<br>```                "name": "get_weather",```<br>``````<br>```                "description": "Weather query",```<br>```                "parameters": {```<br>```                    "properties": {```<br>```                        "location": {```<br>``````<br>```                            "description": "The location for which to query the weather.",```<br>```                            "type": "string"```<br>```                        }```<br>```                    },```<br>```                    "required": [```<br>```                        "location"```<br>```                    ],```<br>```                    "type": "object"```<br>```                }```<br>```            }```<br>```        }```<br>```    ]```<br>```  }'```<br> |**Request of round 1: Trigger tool calling**<br><br>```Bash```<br>```curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \```<br>```    -H "Authorization: Bearer $ARK_API_KEY" \```<br>```    -H "Content-Type: application/json" \```<br>```    -d '{```<br>```        "model": "seed-2-0-lite-260228",```<br>```        "input": [```<br>```            {```<br>```                "role": "system",```<br>``````<br>```                "content": "You are an AI assistant."```<br>```            },```<br>```            {```<br>```                "role": "user",```<br>``````<br>```                "content": "What is the weather like in Beijing today?"```<br>```            }```<br>```        ],```<br>```        "thinking":{"type": "enabled"},```<br>```        "include":["reasoning.encrypted_content"],```<br>```        "tools": [```<br>```            {```<br>```                "type": "function",```<br>```                "name": "get_weather",```<br>``````<br>```                "description": "Weather query",```<br>```                "parameters": {```<br>```                    "type": "object",```<br>```                    "properties": {```<br>```                        "location": {```<br>```                            "type": "string",```<br>``````<br>```                            "description": "The location for which to query the weather."```<br>```                        }```<br>```                    },```<br>```                    "required": ["location"]```<br>```                }```<br>```            }```<br>```        ]```<br>```    }'```<br><br><br>**Response of round 1: Return the tool call instruction**<br><br>The information returned by the model contains key parameters such as `id`, `call_id`, and `arguments`.<br><br>```Bash```<br>```{```<br>```    "created_at": 1766126702,```<br>```    "id": "resp_0217661267019147d8950efa0e2f7c9d9cc7a1cc971272cf4548c",```<br>```    "max_output_tokens": 32768,```<br>```    "model": "seed-1-8-251228",```<br>```    "object": "response",```<br>```    "output": [```<br>```        {```<br>```            "id": "rs_02176612670248500000000000000000000ffffac154e10754f5c",```<br>```            "type": "reasoning",```<br>```            "summary": [```<br>```                {```<br>```                    "type": "summary_text",```<br>``````<br>```                    "text": "The user asks about the weather in Beijing today, and I will call the weather tool to obtain the relevant information."```<br>```                }```<br>```            ],```<br>```            "status": "completed",```<br>```            "encrypted_content": "djEqHS8w8bISWDUfivQXaeCUc8ms2JcjMBO5KQMRqKhTUdYlhbFebcndgVlFJxYUOSOAXm7gNsJdTRtp47iHpps76Rp37ipRrkEHMqIIt+KyKmN/rH9tzL+7ZLI9W4LGYMOv/27Rfqp2NW5vxiF7zkI1xgxxJFp6Vo8PNQpR68T4F7bG4PekickNR3U+EFM6hBKkhnJqxqCrjubi0o/8C35IoDF998+G6hokaDhOb6EqJ5fXaSZvtQJaK4DBh4HIciMFnRqzts/xlacBHsWCWLcxUASrvj0vYIs9a+ZN9BxkLjrBy/nEOOEcmID/I2NukCDEFa7zxlOXLvdZHuslP5cvyno="```<br>```        },```<br>```        {```<br>``````<br>```            "arguments": " {\"location\": \"Beijing\"}",```<br>```            "call_id": "call_t885uulopdd499rn0pioze7l",```<br>```            "name": "get_weather",```<br>```            "type": "function_call",```<br>```            "id": "fc_02176612670345400000000000000000000ffffac154e10a6753e",```<br>```            "status": "completed"```<br>```        }```<br>```    ],```<br>```    ....```<br>``` }```<br><br><br>**Request of round 2: Pass back the results and generate the final response**<br><br>Pass in information from the previous round such as the response_id and tool calling results, then the model generates a response in natural language.<br><br>```Bash```<br>```curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \```<br>```    -H "Authorization: Bearer $ARK_API_KEY" \```<br>```    -H "Content-Type: application/json" \```<br>```    -d '{```<br>```        "model": "seed-2-0-lite-260228",```<br>```        "input": [```<br>```            {```<br>```                "type": "function_call_output",```<br>```                "call_id": "call_t885uulopdd499rn0pioze7l",```<br>``````<br>```                "output": "5 degree"```<br>```            }```<br>```        ],```<br>```        "previous_response_id": "resp_0217661267019147d8950efa0e2f7c9d9cc7a1cc971272cf4548c",```<br>```        "thinking":{"type": "enabled"},```<br>```        "tools": [```<br>```            {```<br>```                "type": "function",```<br>```                "name": "get_weather",```<br>``````<br>```                "description": "Weather query",```<br>```                "parameters": {```<br>```                    "type": "object",```<br>```                    "properties": {```<br>```                        "location": {```<br>```                            "type": "string",```<br>``````<br>```                            "description": "The Location for which to query the weather."```<br>```                        }```<br>```                    },```<br>```                    "required": ["location"]```<br>```                }```<br>```            }```<br>```        ]```<br>```    }'```<br> |


<span id="120ee16f"></span>
### Pass original thinking content back

After deep thinking is enabled, some models will output the original thinking content by default. The following is an example of passing the original thinking content back when tools are called.


<span aceTableMode="list" aceTableWidth="1,5,5"></span>
|API |[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request) |
|---|---|---|
|Supported models |* seed\-2\-0\-lite\-260428<br><br>* seed\-2\-0\-mini\-260428<br><br>* seed\-2\-0\-pro\-260328<br><br>* seed\-2\-0\-lite\-260228<br><br>* seed\-2\-0\-mini\-260215<br><br>* seed\-1\-8\-251228<br><br>* deepseek\-v3\-2\-251201<br><br><br>```Bash```<br>```curl https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions \```<br>```  -H "Content-Type: application/json" \```<br>```  -H "Authorization: Bearer $ARK_API_KEY" \```<br>```  -d '{```<br>```    "model": "seed-2-0-lite-260228",```<br>```    "messages": [```<br>```        {```<br>```            "role": "system",```<br>``````<br>```            "content": "You are an AI assistant."```<br>```        },```<br>```        {```<br>```            "role": "user",```<br>``````<br>```            "content": "What is the weather like in Beijing today?"```<br>```        }```<br>```    ],```<br>```    "thinking":{"type": "enabled"},```<br>```    "tools": [```<br>```        {```<br>```            "type": "function",```<br>```            "function": {```<br>```                "name": "get_weather",```<br>``````<br>```                "description": "Weather query",```<br>```                "parameters": {```<br>```                    "properties": {```<br>```                        "location": {```<br>``````<br>```                            "description": "The location for which to query the weather.",```<br>```                            "type": "string"```<br>```                        }```<br>```                    },```<br>```                    "required": [```<br>```                        "location"```<br>```                    ],```<br>```                    "type": "object"```<br>```                }```<br>```            }```<br>```        }```<br>```    ]```<br>```  }'```<br><br><br>**Response of round 1: Return the tool call instruction**<br><br>The model returns key parameters such as `reasoning_content` and `tool_calls`.<br><br>```JSON```<br>```{```<br>```    "choices": [```<br>```        {```<br>```            "finish_reason": "tool_calls",```<br>```            "index": 0,```<br>```            "logprobs": null,```<br>```            "message": {```<br>```                "content": "",```<br>``````<br>```                "reasoning_content": "The user wants to check today's weather in Beijing, which matches the functionality of the get_weather tool. The location parameter needs to be set to Beijing. Therefore, I will call this tool to retrieve the weather information."```<br>```                "role": "assistant",```<br>```                "tool_calls": [```<br>```                    {```<br>```                        "function": {```<br>``````<br>```                            "arguments": " {\"location\": \"Beijing\"}",```<br>```                            "name": "get_weather"```<br>```                        },```<br>```                        "id": "call_wiezxeyae8jzxl3jx8nhfgb5",```<br>```                        "type": "function"```<br>```                    }```<br>```                ]```<br>```            }```<br>```        }```<br>```    ],```<br>```    ...```<br>``` }```<br><br><br>**Request of round 2: Pass back the full context and generate the final response**<br><br>Based on the request of round 1, pass back the chain\-of\-thought content and tool calling results, then the model generates a response in natural language.<br><br>```Bash```<br>```curl https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions \```<br>```  -H "Content-Type: application/json" \```<br>```  -H "Authorization: Bearer $ARK_API_KEY" \```<br>```  -d '{```<br>```    "model": "seed-2-0-lite-260228",```<br>```    "messages": [```<br>```        {```<br>```            "role": "system",```<br>``````<br>```            "content": "You are an AI assistant."```<br>```        },```<br>```        {```<br>```            "role": "user",```<br>``````<br>```            "content": "What is the weather like in Beijing today?"```<br>```        },```<br>```        {```<br>``````<br>```            "reasoning_content": "<the reasoning content from the previous request>"```<br>```            "role": "assistant",```<br>```            "tool_calls": [```<br>```                {```<br>```                    "function": {```<br>``````<br>```                        "arguments": " {\"location\": \"Beijing\"}",```<br>```                        "name": "get_weather"```<br>```                    },```<br>```                    "id": "call_wiezxeyae8jzxl3jx8nhfgb5",```<br>```                    "type": "function"```<br>```                }```<br>```            ]```<br>```        },```<br>```        {```<br>```            "role": "tool",```<br>```            "tool_call_id":"call_wiezxeyae8jzxl3jx8nhfgb5",```<br>``````<br>```            "content": "5 degree"```<br>```        }```<br>```    ],```<br>```    "thinking":{"type": "enabled"},```<br>```    "tools": [```<br>```        {```<br>```            "type": "function",```<br>```            "function": {```<br>```                "name": "get_weather",```<br>``````<br>```                "description": "Weather query",```<br>```                "parameters": {```<br>```                    "properties": {```<br>```                        "location": {```<br>``````<br>```                            "description": "The location for which to query the weather.",```<br>```                            "type": "string"```<br>```                        }```<br>```                    },```<br>```                    "required": [```<br>```                        "location"```<br>```                    ],```<br>```                    "type": "object"```<br>```                }```<br>```            }```<br>```        }```<br>```    ]```<br>```  }'```<br> |* seed\-2\-0\-lite\-260428<br><br>* seed\-2\-0\-mini\-260428<br><br>* seed\-2\-0\-pro\-260328<br><br>* seed\-2\-0\-lite\-260228<br><br>* seed\-2\-0\-mini\-260215<br><br>* seed\-1\-8\-251228<br><br>* deepseek\-v3\-2\-251201<br><br><br>```Bash```<br>```curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \```<br>```    -H "Authorization: Bearer $ARK_API_KEY" \```<br>```    -H "Content-Type: application/json" \```<br>```    -d '{```<br>```        "model": "seed-2-0-lite-260228",```<br>```        "input": [```<br>```            {```<br>```                "role": "system",```<br>``````<br>```                "content": "You are an AI assistant."```<br>```            },```<br>```            {```<br>```                "role": "user",```<br>``````<br>```                "content": "What is the weather like in Beijing today?"```<br>```            }```<br>```        ],```<br>```        "thinking":{"type": "enabled"},```<br>```        "tools": [```<br>```            {```<br>```                "type": "function",```<br>```                "name": "get_weather",```<br>``````<br>```                "description": "Weather query",```<br>```                "parameters": {```<br>```                    "type": "object",```<br>```                    "properties": {```<br>```                        "location": {```<br>```                            "type": "string",```<br>``````<br>```                            "description": "The location for which to query the weather.",```<br>```                        }```<br>```                    },```<br>```                    "required": ["location"]```<br>```                }```<br>```            }```<br>```        ]```<br>```    }'```<br><br><br>**Response of round 1: Return the tool call instruction**<br><br>The information returned by the model contains key parameters such as `id`, `call_id`, and `arguments`.<br><br>```Bash```<br>```{```<br>```    "created_at": 1766126702,```<br>```    "id": "resp_0217661267019147d8950efa0e2f7c9d9cc7a1cc971272cf4548c",```<br>```    "max_output_tokens": 32768,```<br>```    "model": "seed-1-8-251228",```<br>```    "object": "response",```<br>```    "output": [```<br>```        {```<br>```            "id": "rs_02176612670248500000000000000000000ffffac154e10754f5c",```<br>```            "type": "reasoning",```<br>```            "summary": [```<br>```                {```<br>```                    "type": "summary_text",```<br>``````<br>```                    "text": "Got it, let's see. The user is asking about the weather in Beijing today. I need to use the get_weather function here, with location set to \"Beijing\". Let me make sure to format it correctly with the FunctionCallBegin and End tags. Yep, that's straightforward. Alright, time to write the function call."```<br>```                }```<br>```            ],```<br>```            "status": "completed"```<br>```        },```<br>```        {```<br>``````<br>```            "arguments": " {\"location\": \"Beijing\"}",```<br>```            "call_id": "call_t885uulopdd499rn0pioze7l",```<br>```            "name": "get_weather",```<br>```            "type": "function_call",```<br>```            "id": "fc_02176612670345400000000000000000000ffffac154e10a6753e",```<br>```            "status": "completed"```<br>```        }```<br>```    ],```<br>```    ....```<br>``` }```<br><br><br>**Request of round 2: Pass back the results and generate the final response**<br><br>Pass in information from the previous round such as the response_id and tool calling results, then the model generates a response in natural language.<br><br>```Bash```<br>```curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \```<br>```    -H "Authorization: Bearer $ARK_API_KEY" \```<br>```    -H "Content-Type: application/json" \```<br>```    -d '{```<br>```        "model": "seed-2-0-lite-260228",```<br>```        "input": [```<br>```            {```<br>```                "type": "function_call_output",```<br>```                "call_id": "call_t885uulopdd499rn0pioze7l",```<br>``````<br>```                "output": "5 degree"```<br>```            }```<br>```        ],```<br>```        "previous_response_id": "resp_0217661267019147d8950efa0e2f7c9d9cc7a1cc971272cf4548c",```<br>```        "thinking":{"type": "enabled"},```<br>```        "tools": [```<br>```            {```<br>```                "type": "function",```<br>```                "name": "get_weather",```<br>``````<br>```                "description": "Weather query",```<br>```                "parameters": {```<br>```                    "type": "object",```<br>```                    "properties": {```<br>```                        "location": {```<br>```                            "type": "string",```<br>``````<br>```                            "description": "The Location for which to query the weather."```<br>```                        }```<br>```                    },```<br>```                    "required": ["location"]```<br>```                }```<br>```            }```<br>```        ]```<br>```    }'```<br> |


<span id="8b944a66"></span>
# Instructions

<span id="e1e56b26"></span>
## How it works


* Multi\-turn conversations



<span aceTableMode="list" aceTableWidth="8,3"></span>
|Flowchart |Note |
|---|---|
|<span>![图片](https://asset.ark-doc-resources.com/flowcharts/advanced-usage/deep-thinking-01.svg) </span> |* During each turn of the conversation, the deep reasoning model outputs chain\-of\-thought (CoT) content and the final answer.<br><br>* In the next conversation turn, the previously output chain\-of\-thought content will not be spliced into the context.<br><br>   The chain\-of\-thought content shows the model's problem\-solving process, including splitting the problem into multiple sub\-problems to process, generating multiple responses and synthesizing a better answer, etc. |



* Tool use (seed\-1.8 and later models)


After enabling deep reasoning in the tool use scenario, the chain\-of\-thought content will not be discarded directly to provide more detailed and accurate answers. The chain\-of\-thought content from historical turns will participate in inference as needed (judged independently by the model). During the entire request process, users only need to send back the complete context. The server will independently judge whether to retain the chain\-of\-thought content. The chain\-of\-thought content that is not input to the model will not be counted in the token usage. For code samples, see [Tool calling](https://docs.byteplus.com/en/docs/ModelArk/1449737#3e8661f7).


<span aceTableMode="list" aceTableWidth="8,3"></span>
|Flowchart |Note |
|---|---|
|<span>![图片](https://asset.ark-doc-resources.com/flowcharts/advanced-usage/deep-thinking-02.svg) </span> |* When answering question 1 (requests 1.1 \- 1.2), the model gives the answer after multiple thinking processes and tool calls. ModelArk will input the complete context including the chain\-of\-thought content to the model for processing.<br><br>* When starting to answer question 2 (request 2.1), ModelArk will independently judge and delete the chain\-of\-thought in the previous context before inputting it to the model. |


<span id="bcd721c6"></span>
## Reduce request timeout failures

Deep reasoning models output chain\-of\-thought content, resulting in longer responses and slower speed. Therefore, tasks are very likely to fail due to timeout. Especially in non\-streaming output mode, if the connection is disconnected before the task is complete, no content is output, but token usage fees are still incurred.

You can use streaming output or set a longer timeout to reduce timeout failures:


* Use streaming output (recommended): Generated content is returned immediately in chunks, which can effectively keep the connection active (avoiding connection interruptions caused by no response for a long time). This is an efficient and reliable output method (for code samples and instructions, see [Streaming output](https://docs.byteplus.com/en/docs/ModelArk/1449737#4ad2b076)). If the current application uses non\-streaming output, you can change it to: use the streaming API to obtain content, concatenate the complete result in real time, and then output it as a whole, thereby significantly reducing the risk of request timeout failures.

* Increase the timeout parameter: In non\-streaming output scenarios, we recommend setting the `timeout` parameter to more than 30 minutes and further adjusting the timeout based on the probability of timeout triggers. Also note the TCP Keep\-Alive settings in the network link (the `tcp_keepalive_time` parameter) to avoid connection interruptions by the system, firewall, router, and so on due to no data transmission for a long time.

> **Special note for the ModelArk Go SDK**: Whether or not streaming output is used, you must set the SDK timeout parameter to more than 30 minutes.


<span id="08906e0e"></span>
## Use batch inference for higher throughput

When your business needs to process large amounts of data and does not require timely model responses, you can use batch inference to obtain a quota of at least 10B tokens/day and reduce batch inference costs. Batch inference supports both task\-based and Chat\-like API call methods. To use batch inference, see [Batch inference](https://docs.byteplus.com/en/docs/ModelArk/1399517) for details.

<span id="a33d9cf9"></span>
## Prompt engineering techniques

Deep reasoning models analyze and break down problems on their own (chain of thought), so the focus of prompts differs from that of ordinary models.


* In addition to the problem to be solved, the prompt should include more information such as goals and scenarios. For example, specify requirements such as using English or languages like Python; information about the target audience, such as elementary school students or leaders; scenario information such as writing a paper, completing a project report, or writing a script; and goal information such as demonstrating my professionalism or gaining leadership recognition.

* Reduce or avoid descriptions that break down the problem, such as thinking step by step or using examples, because these will constrain the model's reasoning logic.

* Reduce the use of system prompts. Ask all prompt information directly through the user prompt (`role: user`).




