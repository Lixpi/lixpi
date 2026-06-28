Model context includes input (question) and output (answer). When deep thinking is enabled, the output may also include Chain\-of\-Thought (CoT) content.

CoT shows how the model processes a query—for example, breaking a problem into sub\-questions and synthesizing multiple candidate responses into a better final answer.

In multi\-turn conversations, context management is critical for maintaining topic consistency and continuity. ModelArk provides several methods for managing context.

<span id="5ddcab90"></span>
# Context input

<span id="8739761c"></span>
## Input context manually

[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) requests are independent and stateless, requiring manual context management.

It is necessary to alternate user messages and assistant messages so that the model can obtain previous conversation information in the request.


<Tabs>
<Tab zoneid="eodEDvDITN" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -d '{
    "model": "seed-2-0-lite-260228",
    "messages": [
        {"role": "user", "content": "Differences Between Deep Reasoning Models and Non-Deep-Reasoning Models."},
        {"role": "assistant", "content": "Reasoning models primarily rely on logic, rules, or probabilistic methods to perform analysis, inference, and judgment in order to reach conclusions or make decisions. In contrast, non-reasoning models mainly use pattern recognition, statistical analysis, or simulation to perform tasks such as data description, classification, clustering, or generation, without relying on explicit logical reasoning."},
        {"role": "user", "content": "I want to study the differences between deep reasoning models and non-deep-reasoning models as a research topic. How can I demonstrate my professional expertise in this area?"}
    ]
  }'
```



* You may replace the Model ID as needed. See [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310) for a list of available models.


</Tab>
<Tab zoneid="GMzyQNa1Gw" title="Python">
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
    # Reasoning takes longer; set a larger timeout, with 1,800 seconds or more recommended
    timeout=1800,
)

# Create a conversation request
completion = client.chat.completions.create(
    #Replace with Model ID
    model = "seed-2-0-lite-260228",
    messages=[
        {"role": "user", "content": "Differences Between Deep Reasoning Models and Non-Deep-Reasoning Models"},
        {"role": "assistant", "content": "Reasoning models primarily rely on logic, rules, or probabilistic methods to perform analysis, inference, and judgment in order to reach conclusions or make decisions. In contrast, non-reasoning models mainly use pattern recognition, statistical analysis, or simulation to perform tasks such as data description, classification, clustering, or generation, without relying on explicit logical reasoning."},
        {"role": "user", "content": "I want to study the differences between deep reasoning models and non-deep-reasoning models as a research topic. How can I demonstrate my professional expertise in this area?"},
    ],
)

if hasattr(completion.choices[0].message, 'reasoning_content'):
    print(completion.choices[0].message.reasoning_content)
print(completion.choices[0].message.content)
```



</Tab>
<Tab zoneid="OuWz8Hl5gx" title="Go">
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
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        // Obtain ARK_API_KEY from environment variables via os.Getenv
        os.Getenv("ARK_API_KEY"),
        //The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
        // Reasoning takes longer; please set a larger timeout limit, with 30 minutes or more recommended
        arkruntime.WithTimeout(30*time.Minute),
    )
    // Create a context, typically used to pass request context information such as timeout, cancellation, and so on
    ctx := context.Background()
    // Build a chat completion request, set the request model and message content
    req := model.CreateChatCompletionRequest{
        //Replace with Model ID
        Model: "seed-2-0-lite-260228",
        Messages: []*model.ChatCompletionMessage{
            {
                // The role of the message is user
                Role: model.ChatMessageRoleUser,
                Content: &model.ChatCompletionMessageContent{
                    StringValue: byteplus.String("Differences Between Deep Reasoning Models and Non-Deep-Reasoning Models"),
                },
            },
            {
                // The role of the message is model
                Role: model.ChatMessageRoleAssistant,
                Content: &model.ChatCompletionMessageContent{
                    StringValue: byteplus.String("Reasoning models primarily rely on logic, rules, or probabilistic methods to perform analysis, inference, and judgment in order to reach conclusions or make decisions. In contrast, non-reasoning models mainly use pattern recognition, statistical analysis, or simulation to perform tasks such as data description, classification, clustering, or generation, without relying on explicit logical reasoning."),
                },
            },
            {
                // The role of the message is user
                Role: model.ChatMessageRoleUser,
                Content: &model.ChatCompletionMessageContent{
                    StringValue: byteplus.String("I want to study the differences between deep reasoning models and non-deep-reasoning models as a research topic. How can I demonstrate my professional expertise in this area?"),
                },
            },
        },
    }

    // Send the chat completion request, store the result in resp, and store any possible errors in err
    resp, err := client.CreateChatCompletion(ctx, req)
    if err != nil {
        // If an error occurs, print the error message and terminate the program
        fmt.Printf("standard chat error: %v\\n", err)
        return
    }
    // Check whether deep thinking is triggered; if triggered, print the content of the thought chain
    if resp.Choices[0].Message.ReasoningContent != nil {
        fmt.Println(*resp.Choices[0].Message.ReasoningContent)
    }
    // Print the response result of the chat completion request
    fmt.Println(*resp.Choices[0].Message.Content.StringValue)
}
```



</Tab>
<Tab zoneid="hPJqIgy3OH" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.volcengine.ark.runtime;

import com.byteplus.ark.runtime.model.completion.chat.ChatCompletionRequest;
import com.byteplus.ark.runtime.model.completion.chat.ChatMessage;
import com.byteplus.ark.runtime.model.completion.chat.ChatMessageRole;
import com.byteplus.ark.runtime.service.ArkService;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;

/*** This is a sample class demonstrating how to use ArkService to complete chat functionality. */
public class ChatCompletionsExample {
    public static void main(String[] args) {
        // Obtain the API key from environment variables
        String apiKey = System.getenv("ARK_API_KEY");
        // Create an ArkService instance
        ArkService arkService = ArkService.builder()
                .apiKey(apiKey)
                .timeout(Duration.ofMinutes(30))// Reasoning takes longer; please set a larger timeout limit, recommended to be 30 minutes or more
                //The base URL for model invocation
                .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3")
                .build();
        // Multi-turn message list
        final List<ChatMessage> messages = Arrays.asList(
            ChatMessage.builder().role(ChatMessageRole.USER).content("Differences Between Deep Reasoning Models and Non-Deep-Reasoning Models").build(),
            ChatMessage.builder().role(ChatMessageRole.ASSISTANT).content("Reasoning models primarily rely on logic, rules, or probabilistic methods to perform analysis, inference, and judgment in order to reach conclusions or make decisions. In contrast, non-reasoning models mainly use pattern recognition, statistical analysis, or simulation to perform tasks such as data description, classification, clustering, or generation, without relying on explicit logical reasoning.").build(),
            ChatMessage.builder().role(ChatMessageRole.USER).content("I want to study the differences between deep reasoning models and non-deep-reasoning models as a research topic. How can I demonstrate my professional expertise in this area?").build()
        );
        // Create a chat completion request
        ChatCompletionRequest chatCompletionRequest = ChatCompletionRequest.builder()
                .model("seed-2-0-lite-260228")//Replace with Model ID
                .messages(messages) // Set the message list
                .build();
        // Send the chat completion request and print the response
        try {
            // Obtain the response and print the content of each selected message
            arkService.createChatCompletion(chatCompletionRequest)
                    .getChoices()
                    .forEach(choice -> {
                        // After performing null checks, print the inference content
                        if (choice.getMessage().getReasoningContent() != null) {
                            System.out.println("Reasoning content: " + choice.getMessage().getReasoningContent());
                        } else {
                            System.out.println("Reasoning content is empty");
                        }
                        // Print the message content
                        System.out.println("Message content: " + choice.getMessage().getContent());
                    });
        } catch (Exception e) {
            System.out.println("Request failed: " + e.getMessage());
        } finally {
            // Turn off the service executor
            arkService.shutdownExecutor();
        }
    }
}
```



</Tab>
<Tab zoneid="bUaW4ltee0" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
import os
from openai import OpenAI

client = OpenAI(
    # Read the ModelArk API Key from environment variables
    api_key=os.environ.get("ARK_API_KEY"), 
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3",
    # Reasoning takes longer; to avoid link timeout failures, please set a larger timeout limit, recommended to be 1,800 seconds or more
    timeout=1800,
    )
completion = client.chat.completions.create(
    #Replace with Model ID
    model = "seed-2-0-lite-260228",
    messages=[
        {"role": "user", "content": "Differences Between Deep Reasoning Models and Non-Deep-Reasoning Models"},
        {"role": "assistant", "content": "Reasoning models primarily rely on logic, rules, or probabilistic methods to perform analysis, inference, and judgment in order to reach conclusions or make decisions. In contrast, non-reasoning models mainly use pattern recognition, statistical analysis, or simulation to perform tasks such as data description, classification, clustering, or generation, without relying on explicit logical reasoning."},
        {"role": "user", "content": "I want to study the differences between deep reasoning models and non-deep-reasoning models as a research topic. How can I demonstrate my professional expertise in this area?"},
    ],
)

if hasattr(completion.choices[0].message, 'reasoning_content'):
    print(completion.choices[0].message.reasoning_content)
print(completion.choices[0].message.content)
```



</Tab>
</Tabs>


<span id="cc13704a"></span>
## Input context via ID

[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request) supports a more concise way to manage context.

By default, the input and output of requests are persistently stored. For subsequent requests, simply passing in the ID allows you to retrieve the corresponding input and output of the request.


<Tabs>
<Tab zoneid="Uw13Z84Qlc" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
      "model": "seed-2-0-lite-260228",
      "input": "Hi, tell a joke."    
  }'
```


```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
      "model": "seed-2-0-lite-260228",
      "previous_response_id":"<id>",
      "input": "What is the punchline of this joke?"    
  }'
```


For the second request, replace `<id>` in the curl command with the response ID returned by the previous request.


</Tab>
<Tab zoneid="p98NVhz2S3" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
from byteplussdkarkruntime import Ark

# Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
api_key = os.getenv('ARK_API_KEY')

client = Ark(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

# Create the first-round conversation request
response = client.responses.create(
    model="seed-2-0-lite-260228",
    input="Hi, tell a joke."
)
print(response)

# Create the second-round conversation request
second_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=response.id,
    input=[{"role": "user", "content": "What's the punchline of this joke?"}],
)
print(second_response)
```



</Tab>
<Tab zoneid="wazbxNeNzb" title="Go">
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
    // Create the first-round conversation request
    resp, err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model: "seed-2-0-lite-260228",
        Input: &responses.ResponsesInput{Union: &responses.ResponsesInput_StringValue{StringValue: "Hi, tell a joke."}},
    })
    if err != nil {
        fmt.Printf("response error: %v\\n", err)
        return
    }
    fmt.Println(resp)

    id := resp.GetId()
    inputMessage := &responses.ItemEasyMessage{
        Role:    responses.MessageRole_user,
        Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "What's the punchline of this joke?"}},
    }
    fmt.Println("-----------------")
    // Create the second-round conversation request
    second_resp, second_err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model: "seed-2-0-lite-260228",
        PreviousResponseId: &id,
        Input: &responses.ResponsesInput{
            Union: &responses.ResponsesInput_ListValue{
                ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{{
                    Union: &responses.InputItem_EasyMessage{
                        EasyMessage: inputMessage,
                    },
                }}},
            },
        },
    })
    if second_err != nil {
        fmt.Printf("second response error: %v\\n", second_err)
        return
    }
    fmt.Println(second_resp)
}
```



</Tab>
<Tab zoneid="iQd0JwoxpK" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.example;
import com.byteplus.ark.runtime.model.responses.item.ItemEasyMessage;
import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.model.responses.request.*;
import com.byteplus.ark.runtime.model.responses.response.ResponseObject;
import com.byteplus.ark.runtime.model.responses.constant.ResponsesConstants;
import com.byteplus.ark.runtime.model.responses.item.MessageContent;

public class demo {
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        //The base URL for model invocation
        ArkService arkService = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();
        // Create the first-round conversation request
        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .input(ResponsesInput.builder().stringValue("Hi, tell a joke.").build())
                .build();
        ResponseObject resp = arkService.createResponse(request);
        System.out.println(resp);
        // Create the second-round conversation request
        CreateResponsesRequest request2 = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .previousResponseId(resp.getId())
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder().stringValue("What's the punchline of this joke?").build()
                        ).build()
                ).build())
                .build();
        ResponseObject resp2 = arkService.createResponse(request2);
        System.out.println(resp2);

        arkService.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="Up2Bo0hFW4" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
from openai import OpenAI
import os

# Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
api_key = os.getenv('ARK_API_KEY')

client = OpenAI(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

# Create the first-round conversation request
response = client.responses.create(
    model="seed-2-0-lite-260228",
    input="Hi, tell a joke."
)
print(response)

# Create the second-round conversation request
second_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=response.id,
    input=[{"role": "user", "content": "What's the punchline of this joke?"}],    
)
print(second_response)
```



</Tab>
</Tabs>


<span id="88aa9091"></span>
# Manage context length

When inputting long content or increasing the number of conversation turns, it is necessary to consider both the model output length and the context window limit.

The model input and output are measured, and when the length limit is reached, truncation or an error will occur. Reasonably control the model output length to balance business effectiveness, cost, and stability.


* Reduce the triggering of rate limits (TPM limits, burst traffic limits, and so on) to ensure service stability.

* Precisely control token usage to balance cost and quality.

* Control inference latency to improve user interaction experience.


At the same time, the platform supports controlling the length of model outputs (chain\-of\-thought and answers) to manage token usage. The core specifications and parameters are as shown below:

<span>![图片](https://asset.ark-doc-resources.com/flowcharts/advanced-usage/context-management-01.svg) </span>

> The context window, maximum input, and maximum chain\-of\-thought length supported by different models vary. See [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310) for details.


<span id="3cb3d444"></span>
## Control total output (answer + chain\-of\-thought) length

[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) uses the **max_completion_tokens** field to control the model output length.

When the model output reaches the specified upper limit, the model will stop inference.

> [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request) uses the max_output_tokens field to control the model output length. For more details, see [Set maximum output length](https://docs.byteplus.com/en/docs/ModelArk/1956279#1460ba95).


Supported models: LLMs with version 250528 or later. Unless otherwise specified, this field is supported by default. For the list of LLMs on the ModelArk platform, see [Text generation](https://docs.byteplus.com/en/docs/ModelArk/1330310#b318deb2).

> seed\-translation\-250915 does not support this field.



<Tabs>
<Tab zoneid="n2J2qxxzxi" title="Curl">
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
            "content": "Hello"
        }
    ],
    "max_completion_tokens": 1024
  }'
```



</Tab>
<Tab zoneid="Bl9cfJcCGT" title="Python">
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
    # Reasoning takes longer; set a larger timeout, with 1,800 seconds or more recommended
    timeout=1800,
)

# Create a conversation request
completion = client.chat.completions.create(
    #Replace with Model ID
    model = "seed-2-0-lite-260228",
    messages=[
        {"role": "system", "content": "You are an AI assistant."},
        {"role": "user", "content": "What are some common cruciferous plants?"},
    ],
    # Set the model's maximum output length to 1,024 tokens; adjust as needed
    max_completion_tokens = 1024,
)
print(completion.choices[0].message.content)
```



</Tab>
<Tab zoneid="uQHSJ8vsXV" title="Go">
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
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        //The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
        // Reasoning takes longer; please set a larger timeout limit, recommended to be 30 minutes or more
        arkruntime.WithTimeout(30*time.Minute),
    )
    
    ctx := context.Background()

    fmt.Println("----- standard request -----")
    req := model.CreateChatCompletionRequest{
        //Replace with Model ID
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
                StringValue: byteplus.String("What are some common cruciferous plants?"),
             },
          },
       },
       MaxCompletionTokens: byteplus.Int(1024), // Set the maximum output length to 1,024 tokens
    }

    resp, err := client.CreateChatCompletion(ctx, req)
    if err != nil {
       fmt.Printf("standard chat error: %v\\n", err)
       return
    }
    fmt.Println(*resp.Choices[0].Message.Content.StringValue)
}
```



</Tab>
<Tab zoneid="LDRscFK90u" title="Java">
<TabTitle>Java</TabTitle>

```java
package com.ark.runtime;

import com.byteplus.ark.runtime.model.completion.chat.ChatCompletionRequest;
import com.byteplus.ark.runtime.model.completion.chat.ChatMessage;
import com.byteplus.ark.runtime.model.completion.chat.ChatMessageRole;
import com.byteplus.ark.runtime.service.ArkService;
import java.util.ArrayList;
import java.util.List;
import java.time.Duration;

public class ChatCompletionsExample {
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        // Create an ArkService instance
        ArkService arkService = ArkService.builder()
                .apiKey(apiKey)
                .timeout(Duration.ofMinutes(30))// Reasoning takes longer; please set a larger timeout limit, recommended to be 30 minutes or more
                //The base URL for model invocation
                .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3")
                .build();
        System.out.println("\n----- standard request -----");
        final List<ChatMessage> messages = new ArrayList<>();
        final ChatMessage systemMessage = ChatMessage.builder().role(ChatMessageRole.SYSTEM).content("You are an AI assistant.").build();
        final ChatMessage userMessage = ChatMessage.builder().role(ChatMessageRole.USER).content("What are some common cruciferous plants?").build();
        messages.add(systemMessage);
        messages.add(userMessage);
        ChatCompletionRequest chatCompletionRequest = ChatCompletionRequest.builder()
                .model("seed-2-0-lite-260228")//Replace with Model ID
                .messages(messages)
                .maxCompletionTokens(1024)// Set the maximum output length to 1,024 tokens
                .build();
        arkService.createChatCompletion(chatCompletionRequest).getChoices().forEach(choice -> System.out.println(choice.getMessage().getContent()));
        // Shut down the service.
        arkService.shutdownExecutor();
    }
}
```



</Tab>
</Tabs>


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>



* <div data-tips="true" data-tips-type="tip"><strong>max_tokens</strong> and <strong>max_completion_tokens</strong> cannot be set at the same time; this will result in an immediate error.</div>



<span id="c7fbdbe3"></span>
## Control answer length

[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384): You can control the model answer length by setting the **max_tokens** field. When the answer length reaches the configuration value, the model will stop inference.


<Tabs>
<Tab zoneid="vXd4o8uANz" title="Curl">
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
            "content": "Hello"
        }
    ],
    "max_tokens": 1024
  }'
```



* Replace the Model ID as needed. To query the Model ID, see [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310).


</Tab>
<Tab zoneid="zzgETYZycS" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
# Install SDK:pip install byteplus-python-sdk-v2
from byteplussdkarkruntime import Ark 

# Initialize a ModelArk client.
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
        {"role": "system", "content": "You are an AI assistant."},
        {"role": "user", "content": "What are some common cruciferous plants"},
    ],
    # Set the model's maximum output length to 1,024 tokens; you can adjust as needed
    max_tokens=1024,
)
print(completion.choices[0].message.content)
```



</Tab>
<Tab zoneid="QFr40NLyg2" title="Go">
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
             Role: model.ChatMessageRoleSystem,
             Content: &model.ChatCompletionMessageContent{
                StringValue: byteplus.String("You are an AI assistant."),
             },
          },
          {
             Role: model.ChatMessageRoleUser,
             Content: &model.ChatCompletionMessageContent{
                StringValue: byteplus.String("What are some common cruciferous plants?"),
             },
          },
       },
       MaxTokens: byteplus.Int(1024), // Set the maximum output length to 1,024 tokens
    }

    resp, err := client.CreateChatCompletion(ctx, req)
    if err != nil {
       fmt.Printf("standard chat error: %v\\n", err)
       return
    }
    fmt.Println(*resp.Choices[0].Message.Content.StringValue)
}
```



</Tab>
<Tab zoneid="ntq30C4GlO" title="Java">
<TabTitle>Java</TabTitle>

```java
package com.ark.sample;

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
        System.out.println("----- standard request -----");
        final List<ChatMessage> messages = new ArrayList<>();
        final ChatMessage systemMessage = ChatMessage.builder().role(ChatMessageRole.SYSTEM).content("You are an AI assistant.").build();
        final ChatMessage userMessage = ChatMessage.builder().role(ChatMessageRole.USER).content("What are some common cruciferous plants?").build();
        messages.add(systemMessage);
        messages.add(userMessage);

        ChatCompletionRequest chatCompletionRequest = ChatCompletionRequest.builder()
               .model("seed-2-0-lite-260228")//Replace with Model ID
               .messages(messages)
               .maxTokens(1024)// Set the maximum output length to 1,024 tokens
               .build();
        service.createChatCompletion(chatCompletionRequest).getChoices().forEach(choice -> System.out.println(choice.getMessage().getContent()));
        // Shut down the service.
        service.shutdownExecutor();
    }
}
```



</Tab>
</Tabs>


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>



* <div data-tips="true" data-tips-type="tip"><strong>max_tokens</strong> and <strong>max_completion_tokens</strong> cannot be set at the same time; this will result in an immediate error.</div>


* <div data-tips="true" data-tips-type="tip"><a href="https://docs.byteplus.com/en/docs/ModelArk/Create_model_request">Responses API</a> does not support the <strong>max_tokens</strong> field.</div>



<span id="480730d0"></span>
## Control CoT length [New]

Set **reasoning_effort** to adjust the degree of reasoning effort, indirectly controlling the length of CoT. Currently, 4 levels are provided:


* `minimal`: Turn off thinking and answer directly.

* `low`: Lightweight thinking, focusing on quick response.

* `medium`: Balanced mode, considering both speed and depth.

* `high`: Deep analysis, handling complex problems.


**reasoning_effort** and **thinking.type**:


* If **thinking.type** is set to `enabled`, configuration of **reasoning_effort** is supported. When **reasoning_effort** is set to `minimal`, thinking is turned off and answers are given directly.

* If **thinking.type** is set to `disabled`, **reasoning_effort** only supports the value `minimal`. If **reasoning_effort** is set to `low`, `medium`, or `high`, an error will be reported.



<Tabs>
<Tab zoneid="eJog4Je0yx" title="Curl">
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
             "content": [
                {
                    "image_url": {
                        "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/view.jpeg"
                    },
                    "type": "image_url"
                },
                {
                    "text": "What is in the image",
                    "type": "text"
                }
            ]
         }
     ],
     "thinking":{"type":"enabled"},
     "reasoning_effort": "low"
}'
```



</Tab>
<Tab zoneid="tHgzoftvkr" title="Python">
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
    # Deep thinking takes longer; set a larger timeout, with 1,800 seconds or more recommended
    timeout=1800,
)

completion = client.chat.completions.create(
    #Replace with Model ID  .
    model = "seed-2-0-lite-260228",
    messages=[
        {
            "role": "user",
             "content": [                
                {"type": "image_url","image_url": {"url":  "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/view.jpeg"}},
                {"type": "text", "text": "What's in the image"},
            ],
        }
    ],
    thinking={"type":"enabled"},
    reasoning_effort="low"
)

print(completion.choices[0])
```



</Tab>
<Tab zoneid="DO8EIuolmt" title="Go">
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
        // Use os.Getenv to obtain ARK_API_KEY from environment variables
        os.Getenv("ARK_API_KEY"),
        //The base URL for model invocation  .
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    // Create a context, usually used to pass contextual information for requests, such as timeout, cancel, and so on
    ctx := context.Background()
    contentParts := []*model.ChatCompletionMessageContentPart{
        // The first image
        {
            Type: "image_url",
            ImageURL: &model.ChatMessageImageURL{
                URL: "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/view.jpeg",
            },
        },
        // Text content
        {
            Type: "text",
            Text: "What's in the image",
        },
    }
    effort := model.ReasoningEffortLow
    req := model.CreateChatCompletionRequest{
        //Replace with Model ID
       Model: "seed-2-0-lite-260228",
       Messages: []*model.ChatCompletionMessage{
          {
             // The role of the message is user
             Role: model.ChatMessageRoleUser,
             Content: &model.ChatCompletionMessageContent{
                ListValue: contentParts, // Use ListValue for multi-type content
             },
          },
       },
       Thinking:        &model.Thinking{Type: model.ThinkingTypeEnabled},
        ReasoningEffort: &effort,
    }

    // Send the chat completion request, store the result in resp, and store any possible errors in err
    resp, err := client.CreateChatCompletion(ctx, req)
    if err != nil {
       // If an error occurs, print the error message and terminate the program
       fmt.Printf("standard chat error: %v\\n", err)
       return
    }
    // Print the response result of the chat completion request
    fmt.Println(*resp.Choices[0].Message.Content.StringValue)
}
```



</Tab>
<Tab zoneid="FTB275RfOW" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.byteplus.ark.runtime.model.completion.chat.*;
import com.byteplus.ark.runtime.model.completion.chat.ChatCompletionContentPart.*;
import com.byteplus.ark.runtime.service.ArkService;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

public class MultiImageSample {
  static String apiKey = System.getenv("ARK_API_KEY");
  static ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
  static Dispatcher dispatcher = new Dispatcher();
  static ArkService arkService = ArkService.builder()
       .dispatcher(dispatcher)
       .connectionPool(connectionPool)
       .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3") //The base URL for model invocation  .
       .apiKey(apiKey)
       .build();

  public static void main(String[] args) throws Exception {

    List<ChatMessage> messagesForReqList = new ArrayList<>();

    // Build the message content
    List<ChatCompletionContentPart> contentParts = new ArrayList<>();

    // Use builder mode for the first image part
    contentParts.add(ChatCompletionContentPart.builder()
         .type("image_url")
         .imageUrl(new ChatCompletionContentPartImageURL(
            "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/view.jpeg"))
         .build());

    contentParts.add(ChatCompletionContentPart.builder()
         .type("text")
         .text("What's in the image")
         .build());

    messagesForReqList.add(ChatMessage.builder()
         .role(ChatMessageRole.USER)
         .multiContent(contentParts)
         .build());

    ChatCompletionRequest req = ChatCompletionRequest.builder()
         .model("seed-2-0-lite-260228") //Replace with Model ID  .
         .messages(messagesForReqList)
         .thinking(new ChatCompletionRequest.ChatCompletionRequestThinking("enabled"))
         .reasoningEffort("low")
         .build();

    arkService.createChatCompletion(req)
         .getChoices()
         .forEach(choice -> System.out.println(choice.getMessage().getContent()));
    // shutdown service after all requests are finished
    arkService.shutdownExecutor();
  }
}
```



</Tab>
<Tab zoneid="ah1wgt21Ub" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
import os
from openai import OpenAI 

client = OpenAI(
    #The base URL for model invocation  .
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
)

completion = client.chat.completions.create(
    #Replace with Model ID  .
    model = "seed-2-0-lite-260228",
    messages=[
        {
            "role": "user",
             "content": [                
                {"type": "image_url","image_url": {"url":  "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/view.jpeg"}},
                {"type": "text", "text": "What's in the image"},
            ],
        }
    ],
    extra_body={"thinking":{"type":"enabled"}},
    reasoning_effort="low"
)

print(completion.choices[0])
```



</Tab>
</Tabs>


For complete code and usage, see [Adjusting reasoning length](https://docs.byteplus.com/en/docs/ModelArk/1956279#dc4c1547) (Responses API) and [Adjust reasoning length](https://docs.byteplus.com/en/docs/ModelArk/1449737#fc5eac89) (ChatCompletion API).

<span id="a8d2f4a8"></span>
# Context passing logic

<span id="41d0a095"></span>
## Multi\-turn conversation scenarios


|Flowchart |Description |
|---|---|
|<span>![图片](https://asset.ark-doc-resources.com/flowcharts/advanced-usage/context-management-02.svg) </span> |* During each round of conversation, the deep reasoning model outputs chain\-of\-thought (CoT) content and the final answer.<br><br>* In the next round of conversation, previously output chain\-of\-thought content will not be concatenated into the context.<br><br>> The chain\-of\-thought content demonstrates the model's process for handling the problem, including breaking the problem into multiple subproblems, generating multiple responses, and synthesizing a better answer. |


<span id="a0247227"></span>
## Tool invocation scenarios

After turning on deep thinking in tool invocation scenarios, the reasoning chain processing strategy changes as follows:


* **Legacy strategy** (models before seed\-1.8): After turning on deep thinking, the generated reasoning chain content is directly discarded and does not participate in subsequent rounds of inference.

* **New strategy** (seed\-1.8 and newly iterated model): The execution logic for deep reasoning in tool invocation scenarios is optimized. The platform autonomously determines whether to input reasoning chain content to the model, allowing it to participate in subsequent rounds of inference, ensuring coherent, accurate, and interpretable output results.


Strategy changes will lead to an increase in model input tokens. CoT content not input to the model will not be counted in token usage.


|Flowchart |Description |
|---|---|
|<span>![图片](https://asset.ark-doc-resources.com/flowcharts/advanced-usage/context-management-03.svg) </span> |* When answering question 1 (request 1.1 \- 1.2), the model provides an answer after multiple rounds of reasoning and tool invocation. ModelArk inputs the complete context, including chain\-of\-thought content, for the model to process.<br><br>* When starting to answer question 2 (request 2.1), ModelArk will determine whether to delete the chain\-of\-thought from the previous context before inputting it to the model. |


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">It is recommended to use <code>previous_response_id</code> in the Responses API. The platform automatically saves the context of historical conversations and returns it to the inference service during multi\-turn interactions.</div>


Request example is as follows:


<Tabs>
<Tab zoneid="eWqNN3ggdE" title="Chat API">
<TabTitle>Chat API</TabTitle>

**First\-round request: Trigger tool invocation**

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -d '{
    "model": "seed-2-0-lite-260228",
    "messages": [
        {
            "role": "system",
            "content": "You are an AI assistant."
        },
        {
            "role": "user",
            "content": "What is the weather like in Beijing today?"
        }
    ],
    "tools": [
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Weather query",
                "parameters": {
                    "properties": {
                        "location": {
                            "description": "The location for which to query the weather.",
                            "type": "string"
                        }
                    },
                    "required": [
                        "location"
                    ],
                    "type": "object"
                }
            }
        }
    ]
  }'
```


**First\-round response: Return tool invocation instructions**

The model will return key fields such as `reasoning_content` and `tool_calls`.

```Bash
{
    "choices": [
        {
            "finish_reason": "tool_calls",
            "index": 0,
            "logprobs": null,
            "message": {
                "content": "",
                "reasoning_content": "Got it, let's see. The user is asking about the weather in Beijing today. I need to use the get_weather function with location set to Beijing. Let me make sure the format is correct. It should start with <|FunctionCallBegin|> and end with <|FunctionCallEnd|>, and the parameters have location as \\"Beijing\\". Alright, time to write that out.",
                "role": "assistant",
                "tool_calls": [
                    {
                        "function": {
                            "arguments": " {\\"location\\": \\"Beijing\\"}",
                            "name": "get_weather"
                        },
                        "id": "call_wiezxeyae8jzxl3jx8nhfgb5",
                        "type": "function"
                    }
                ]
            }
        }
    ],
    ...
 }
```


**Second\-round request: Return the complete context and generate the final response**

The second\-round request also needs to return chain\-of\-thought information and tool invocation results; the model generates the answer.

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -d '{
    "model": "seed-2-0-lite-260228",
    "messages": [
        {
            "role": "system",
            "content": "You are an AI assistant."
        },
        {
            "role": "user",
            "content": "What is the weather like in Beijing today?"
        },
        {
            "role": "assistant",
            "reasoning_content": "<the reasoning content from the previous request>",
            "tool_calls": [
                {
                    "function": {
                        "arguments": " {\\"location\\": \\"Beijing\\"}",
                        "name": "get_weather"
                    },
                    "id": "call_wiezxeyae8jzxl3jx8nhfgb5",
                    "type": "function"
                }
            ]
        },
        {
            "role": "tool",
            "tool_call_id":"call_wiezxeyae8jzxl3jx8nhfgb5",
            "content": "5 degree"
        }
    ],
    "tools": [
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Weather query",
                "parameters": {
                    "properties": {
                        "location": {
                            "description": "The location for which to query the weather.",
                            "type": "string"
                        }
                    },
                    "required": [
                        "location"
                    ],
                    "type": "object"
                }
            }
        }
    ]
  }'
```



</Tab>
<Tab zoneid="k0Wj8Evn4F" title="Responses API">
<TabTitle>Responses API</TabTitle>

**First\-round request: Trigger tool invocation**

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
    -H "Authorization: Bearer $ARK_API_KEY" \\
    -H "Content-Type: application/json" \\
    -d '{
        "model": "seed-2-0-lite-260228",      
        "input": [
            {
                "role": "system",
                "content": "You are an AI assistant."
            },
            {
                "role": "user",
                "content": "What is the weather like in Beijing today?"
            }
        ],
        "thinking":{"type": "enabled"},
        "tools": [
            {
                "type": "function",
                "name": "get_weather",
                "description": "Weather query",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "location": {
                            "type": "string",
                            "description": "The location for which to query the weather.",                    
                        }
                    },
                    "required": ["location"]
                }
            }
        ]
    }'
```


**First\-round response: Return tool invocation instructions**

The model returns information including key fields such as `id`, `call_id`, and `arguments`.

```Bash
{
    "created_at": 1766126702,
    "id": "resp_0217661267019147d8950efa0e2f7c9d9cc7a1cc971272cf4548c",
    "max_output_tokens": 32768,
    "model": "seed-1-8-251228",
    "object": "response",
    "output": [
        {
            "id": "rs_02176612670248500000000000000000000ffffac154e10754f5c",
            "type": "reasoning",
            "summary": [
                {
                    "type": "summary_text",
                    "text": "Got it, let's see. The user is asking about the weather in Beijing today. I need to use the get_weather function here, with location set to \\"Beijing\\". Let me make sure to format it correctly with the FunctionCallBegin and End tags. Yep, that's straightforward. Alright, time to write the function call."
                }
            ],
            "status": "completed"
        },
        {
            "arguments": " {\\"location\\": \\"Beijing\\"}",
            "call_id": "call_t885uulopdd499rn0pioze7l",
            "name": "get_weather",
            "type": "function_call",
            "id": "fc_02176612670345400000000000000000000ffffac154e10a6753e",
            "status": "completed"
        }
    ],
    ....
 }
```


**Second\-round request: Return results and generate the final response**

Provide the previous round's response_id, tool invocation results, and other information; the model generates a natural language answer.

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
    -H "Authorization: Bearer $ARK_API_KEY" \\
    -H "Content-Type: application/json" \\
    -d '{
        "model": "seed-2-0-lite-260228",
        "input": [
            {
                "type": "function_call_output",
                "call_id": "call_t885uulopdd499rn0pioze7l",
                "output": "5 degree"
            }
        ],
        "previous_response_id": "resp_0217661267019147d8950efa0e2f7c9d9cc7a1cc971272cf4548c",
        "thinking":{"type": "enabled"},
        "tools": [
            {
                "type": "function",
                "name": "get_weather",
                "description": "Weather query",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "location": {
                            "type": "string",
                            "description": "The Location for which to query the weather."
                        }
                    },
                    "required": ["location"]
                }
            }
        ]
    }'
```



</Tab>
</Tabs>


<span id="e9fab508"></span>
# How length limits are applied

The model output can be expressed as the following formula:

`Model output = Model's answer + CoT (if applicable)`


* **max_tokens**: Controls the model answer length. Default is 4096.

   If the length limit is triggered, the model will stop answering, and the **finish_reason** field in the returned structure will be `length`.

* **max_completion_tokens**: Controls the total length of the model's answer and CoT. If the limit is triggered, the model will stop responding, and the **finish_reason** field in the returned structure will be `length`. If **max_completion_tokens** is configured, the default value of **max_tokens** becomes invalid. This is commonly used for ultra\-long text output or to control the length of the model's response.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>



* <div data-tips="true" data-tips-type="tip"><strong>max_tokens</strong> and <strong>max_completion_tokens</strong> cannot be set at the same time; this will result in an immediate error.</div>


* <div data-tips="true" data-tips-type="tip">For <a href="https://docs.byteplus.com/en/docs/ModelArk/1494384">Chat API</a>, if neither field is specified, a max_tokens of 4096 is applied by default.</div>


* <div data-tips="true" data-tips-type="tip"><a href="https://docs.byteplus.com/en/docs/ModelArk/Create_model_request">Responses API</a> does not support the <strong>max_tokens</strong> field.</div>



<span id="13bc800b"></span>
## Configure max_tokens only (default)

The following are length limits for each object.


|Object |Key Influencing Parameters |Description |Configurable |
|---|---|---|---|
|Question |Maximum input length |`Context window - chain-of-thought window`<br><br><br>* Shared with the model's answer.<br><br>* This can be understood as the model Q&A quota. |Not configurable (Model specification) |
|Chain\-of\-thought |Chain\-of\-thought window |Exclusive, not shared; that is, any unused quota in a single request is not shared with questions and answers. |Not configurable (Model specification) |
|Maximum input length |Maximum answer length |Maximum answer length is configured via the **max_tokens** parameter.<br><br>Additionally, as input length increases, the answer quota is also affected by the remaining quota of **maximum input length (Q&A quota)** .<br><br>Answer quota:<br><br>=`min (maximum answer length, maximum input length - actual input length)`<br><br>=`min (maximum answer length, context window - chain of thought window - actual input length)` |Configurable via API field |
||Maximum input length ||Not configurable (Model specification) |


Example of content truncation logic: Model A has the following properties—context window 96k, CoT window 32k, maximum input length (Q&A quota) 64k, and configured maximum answer length (**max_tokens**) 16k.


* When the user's input question is 56k, the model's CoT output is 16k, and the model's answer reaches 8k, `question + answer = 56k + 8k = 64k`, triggering the **maximum input length (Q&A quota)**  limit, and the model stops inference.

* When the user's input question is 22k, the model's CoT output is 16k, and the model's answer reaches 16k, the **maximum response length** limit is triggered, and the model stops inference.

* When the user's input question is 22k and the model's CoT output is 32k, the **maximum CoT length** limit is triggered, and the model stops inference.


<span id="04191ca1"></span>
## Configure **max_completion_tokens only**


|Object |Key Influencing Parameters |Description |Configurable |
|---|---|---|---|
|Question |Maximum input length |Quota is shared with answers; that is, unused quota is shared with answers. |Not configurable (Model specification) |
|Chain\-of\-thought |Maximum output length |Quota is shared with answers; that is, unused quota is shared with answers. |Configurable via API field |
| |Chain\-of\-thought window |The maximum chain of thought length that the model can output. |Not configurable (Model specification) |
|Answer |Maximum output length |Quota is shared with CoT; that is, output length cannot exceed `maximum output length - length of CoT already output` |Configurable via API field |


Example of content truncation logic: Model A has the following properties—context window 96k, maximum input length 64k, maximum reasoning chain length 32k.

After configuring the maximum output length (**max_completion_tokens**) to 32k, the default value (`4096`) limit for maximum response length (**max_tokens**) becomes invalid:


* When the user's input content length is 72k, the **maximum input length** limit is triggered, resulting in a direct error.

* When the model's output content exceeds 32k, the **maximum CoT length** limit is triggered, and the model stops inference.

* When the user's input question length is 26k, the model's CoT output length is 16k, and the model's answer length reaches 16k, `CoT length + answer length = 16k + 16k = 32k`, triggering the **maximum output length** limit, and the model stops inference.


&nbsp;



