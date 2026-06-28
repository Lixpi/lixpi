The Responses API supports a more concise input and output format, enabling more efficient context management. It is recommended for use in projects.

For information about how to use the Chat API for text generation, see [Text generation](https://docs.byteplus.com/en/docs/ModelArk/1399009) (Chat API).

<span id="3c7d0ec8"></span>
## Prerequisites

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">If you're new to ModelArk, see <a href="https://docs.byteplus.com/en/docs/ModelArk/1399008">Quick start</a> to get up and running quickly.</div>


<span id="4235b381"></span>
## Model list

LLMs released after 250615, unless otherwise specified, support the Responses API by default. For the list of supported models, see [Text generation](https://docs.byteplus.com/en/docs/ModelArk/1330310#b318deb2).

<span id="17377051"></span>
## Quick start


<Tabs>
<Tab zoneid="whTbstg4z7" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
      "model": "seed-2-0-lite-260228",
      "input": "hello"
  }'
```



</Tab>
<Tab zoneid="TEDk9MvW3Y" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
from byteplussdkarkruntime import Ark

client = Ark(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=os.getenv('ARK_API_KEY'),
)

response = client.responses.create(
    model="seed-2-0-lite-260228",
    input="hello"
)
print(response)
```



</Tab>
<Tab zoneid="NfLaW9faIa" title="Go">
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

    resp, err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model: "seed-2-0-lite-260228",
        Input: &responses.ResponsesInput{Union: &responses.ResponsesInput_StringValue{StringValue: "hello"}},
    })
    if err != nil {
        fmt.Printf("response error: %v\\n", err)
        return
    }
    fmt.Println(resp)
}
```



</Tab>
<Tab zoneid="P7Hl4GtdjO" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.example;
import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.model.responses.request.*;
import com.byteplus.ark.runtime.model.responses.response.ResponseObject;

public class demo {
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        //The base URL for model invocation
        ArkService arkService = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .input(ResponsesInput.builder().stringValue("hello").build())
                .build();

        ResponseObject resp = arkService.createResponse(request);
        System.out.println(resp);

        arkService.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="tUzoDM1KIQ" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
import os
from openai import OpenAI

client = OpenAI(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=os.getenv('ARK_API_KEY'),
)

response = client.responses.create(
    model="seed-2-0-lite-260228",
    input="hello"
)

print(response)
```



</Tab>
</Tabs>


<span id="307a0465"></span>
## API reference

[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)

<span id="6d3df616"></span>
## Context management

Context state management is simple. By default, the input and reply of each request (excluding chain\-of\-thought content) are persistently stored. Subsequent requests only need to pass the id to retrieve the corresponding input and reply, without needing to pass historical conversations for each request as with the Chat API. For details, see [How context management works](https://docs.byteplus.com/en/docs/ModelArk/1958520#abd1d689).

<span id="6854a805"></span>
### Multi\-turn conversations

In multi\-turn mode, the system can automatically manage context, continuously track and remember previous dialogue content, making conversations more coherent and natural, and enhancing the intelligent interaction experience.


<Tabs>
<Tab zoneid="rNB51HR2Gu" title="Curl">
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


For the second request, replace `<id>` in the curl command with the Response id returned by the previous request.


</Tab>
<Tab zoneid="xK1pl4vC7u" title="Python">
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
<Tab zoneid="QiVV8z7Ezd" title="Go">
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
<Tab zoneid="kgi7iJg73p" title="Java">
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
<Tab zoneid="jgLnc9PnEs" title="OpenAI SDK">
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


<span id="6237dc39"></span>
### Regenerate conversations

This example demonstrates how to use `previous_response_id` in the Responses API to regenerate conversations with a tree\-like branching structure. It shows how different operations can be performed across multiple branches.

In conversation regeneration scenarios, the system can flexibly execute different actions based on branching conditions, enabling the implementation of more complex and dynamic conversation logic.


<Tabs>
<Tab zoneid="rKBL1NEWRR" title="Python">
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
    input=[{"role": "user", "content": "Do you know the principle of cosine similarity?"}],
    store=True,  # store the conversation
)
print(response)

# Create the second-round conversation request
second_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=response.id,
    input=[{"role": "user", "content": "I hope you can explain this problem in a way that even elementary school students can understand"}],
    store=True, 
)
print(second_response)

# Recreate the second-round conversation request
re_second_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=response.id,
    input=[{"role": "user", "content": "I hope you can explain this problem using a professor's thinking logic"}],
    store=True,  
)
print(re_second_response)
```



</Tab>
<Tab zoneid="JFvbrYO2AE" title="Go">
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
    store := true
    // Create the first-round conversation request
    resp, err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model: "seed-2-0-lite-260228",
        Input: &responses.ResponsesInput{
            Union: &responses.ResponsesInput_ListValue{
                ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{{
                    Union: &responses.InputItem_EasyMessage{
                        EasyMessage: &responses.ItemEasyMessage{
                            Role:    responses.MessageRole_user,
                            Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "Do you know the principle of cosine similarity?"}},
                        },
                    },
                }}},
            },
        },
        Store: &store,
    })
    if err != nil {
        fmt.Printf("response error: %v\\n", err)
        return
    }
    fmt.Println(resp)

    id := resp.GetId()
    fmt.Println("-----------------")
    // Create the second-round conversation request
    second_resp, second_err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model:              "seed-2-0-lite-260228",
        PreviousResponseId: &id,
        Input: &responses.ResponsesInput{
            Union: &responses.ResponsesInput_ListValue{
                ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{{
                    Union: &responses.InputItem_EasyMessage{
                        EasyMessage: &responses.ItemEasyMessage{
                            Role:    responses.MessageRole_user,
                            Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "I hope you can explain this problem in a way that even elementary school students can understand"}},
                        },
                    },
                }}},
            },
        },
        Store: &store,
    })
    if second_err != nil {
        fmt.Printf("second response error: %v\\n", second_err)
        return
    }
    fmt.Println(second_resp)
    fmt.Println("-----------------")
    // Recreate the second-round conversation request
    re_second_resp, re_second_err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model:              "seed-2-0-lite-260228",
        PreviousResponseId: &id,
        Input: &responses.ResponsesInput{
            Union: &responses.ResponsesInput_ListValue{
                ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{{
                    Union: &responses.InputItem_EasyMessage{
                        EasyMessage: &responses.ItemEasyMessage{
                            Role:    responses.MessageRole_user,
                            Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "I hope you can explain this problem using a professor's thinking logic"}},
                        },
                    },
                }}},
            },
        },
        Store: &store,
    })
    if re_second_err != nil {
        fmt.Printf("reSecond response error: %v\\n", re_second_err)
        return
    }
    fmt.Println(re_second_resp)
}
```



</Tab>
<Tab zoneid="wm18E22V71" title="Java">
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
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                 MessageContent.builder().stringValue("Do you know the principle of cosine similarity?").build()  
                        ).build()
                ).build())
                .store(true)
                .build();
        ResponseObject resp = arkService.createResponse(request);
        System.out.println(resp);
        // Create the second-round conversation request
        CreateResponsesRequest request2 = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .previousResponseId(resp.getId())
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder().stringValue("I hope you can explain this problem in a way that even elementary school students can understand").build()
                        ).build()
                ).build())
                .build();
        ResponseObject resp2 = arkService.createResponse(request2);
        System.out.println(resp2);
        // Recreate the second-round conversation request
        CreateResponsesRequest reRequest2 = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .previousResponseId(resp.getId())
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder().stringValue("I hope you can explain this problem using a professor's thinking logic").build()
                        ).build()
                ).build())
                .build();
        ResponseObject reResp2 = arkService.createResponse(reRequest2);
        System.out.println(reResp2);

        arkService.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="aOZRWgM426" title="OpenAI SDK">
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
    input=[{"role": "user", "content": "Do you know the principle of cosine similarity?"}],
    store=True,  # Set to True to store the conversation
)
print(response)

# Create the second-round conversation request
second_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=response.id,
    input=[{"role": "user", "content": "I hope you can explain this problem in a way that even elementary school students can understand"}],
    store=True, 
)
print(second_response)

# Recreate the second-round conversation request
re_second_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=response.id,
    input=[{"role": "user", "content": "I hope you can explain this problem using a professor's thinking logic"}],
    store=True,  
)
print(re_second_response)
```



</Tab>
</Tabs>


<span id="fb6f5b9a"></span>
### Window truncation

This example demonstrates how to use the delete interface to implement the window truncation feature of the Responses API, allowing the program to manage historical memory at the level of individual responses and facilitating more complex subsequent dialogues.


<Tabs>
<Tab zoneid="lNEMdwDNgw" title="Python">
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

response = client.responses.create(
    model="seed-2-0-lite-260228",
    input="Tell a pun joke.",
)
print(response)

second_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=response.id,
    input=[{"role": "user", "content": "Tell a philosophical joke"}],
)
print(second_response)

third_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=second_response.id,
    input=[{"role": "user", "content": "Tell a cold joke"}],
)
print(third_response)

deleting_response = client.responses.delete(second_response.id)
print(deleting_response)

fourth_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=third_response.id,
    input=[{"role": "user", "content": "How many jokes did you just tell? What were they all about?"}],
)
print(fourth_response)
```



</Tab>
<Tab zoneid="qLyGSjuG8v" title="Go">
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

    resp, err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model: "seed-2-0-lite-260228",
        Input: &responses.ResponsesInput{Union: &responses.ResponsesInput_StringValue{StringValue: "Tell a pun joke."}},
    })
    if err != nil {
        fmt.Printf("response error: %v\\n", err)
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
                            Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "Tell a philosophical joke"}},
                        },
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

    third_resp, third_err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model:              "seed-2-0-lite-260228",
        PreviousResponseId: &second_resp.Id,
        Input: &responses.ResponsesInput{
            Union: &responses.ResponsesInput_ListValue{
                ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{{
                    Union: &responses.InputItem_EasyMessage{
                        EasyMessage: &responses.ItemEasyMessage{
                            Role:    responses.MessageRole_user,
                            Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "Tell a cold joke"}},
                        },
                    },
                }}},
            },
        },
    })
    if third_err != nil {
        fmt.Printf("second response error: %v\\n", third_err)
        return
    }
    fmt.Println(third_resp)

    deleting_resp := client.DeleteResponse(ctx, second_resp.Id)
    fmt.Println(deleting_resp)

    forth_resp, forth_err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model:              "seed-2-0-lite-260228",
        PreviousResponseId: &third_resp.Id,
        Input: &responses.ResponsesInput{
            Union: &responses.ResponsesInput_ListValue{
                ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{{
                    Union: &responses.InputItem_EasyMessage{
                        EasyMessage: &responses.ItemEasyMessage{
                            Role:    responses.MessageRole_user,
                            Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "How many jokes did you just tell? What were they all about?"}},
                        },
                    },
                }}},
            },
        },
    })
    if forth_err != nil {
        fmt.Printf("second response error: %v\\n", forth_err)
        return
    }
    fmt.Println(forth_resp)
}
```



</Tab>
<Tab zoneid="jM9uko8t3Y" title="Java">
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

public class demo {
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        //The base URL for model invocation
        ArkService arkService = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .input(ResponsesInput.builder().stringValue("Tell a pun joke.").build())
                .build();
        ResponseObject resp = arkService.createResponse(request);
        System.out.println(resp);
        System.out.println("---------------------");
        CreateResponsesRequest request2 = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .previousResponseId(resp.getId())
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder().stringValue("Tell me a philosophical joke").build()
                        ).build()
                ).build())
                .build();
        ResponseObject resp2 = arkService.createResponse(request2);
        System.out.println(resp2);
        System.out.println("---------------------");
        CreateResponsesRequest request3 = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .previousResponseId(resp2.getId())
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder().stringValue("Tell a cold joke").build()
                        ).build()
                ).build())
                .build();
        ResponseObject resp3 = arkService.createResponse(request3);
        System.out.println(resp3);
        System.out.println("---------------------");
        DeleteResponseResponse deleteResp = arkService.deleteResponse(
                DeleteResponseRequest.builder().responseId(resp2.getId()).build()
        );
        System.out.println(deleteResp);
        System.out.println("---------------------");
        CreateResponsesRequest request4 = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .previousResponseId(resp3.getId())
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder().stringValue("How many jokes did you just tell? What were they all about?").build()
                        ).build()
                ).build())
                .build();
        ResponseObject resp4 = arkService.createResponse(request4);
        System.out.println(resp4);

        arkService.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="OjtRTnztx6" title="OpenAI SDK">
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

response = client.responses.create(
    model="seed-2-0-lite-260228",
    input="Tell a pun joke.",
)
print(response)

second_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=response.id,
    input=[{"role": "user", "content": "Tell a philosophical joke"}],
)
print(second_response)

third_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=second_response.id,
    input=[{"role": "user", "content": "Tell a cold joke"}],
)
print(third_response)

deleting_response = client.responses.delete(second_response.id)
print(deleting_response)

fourth_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=third_response.id,
    input=[{"role": "user", "content": "How many jokes did you just tell? What were they all about?"}],
)
print(fourth_response)
```



</Tab>
</Tabs>


<span id="641bafe0"></span>
## Streaming output

Streaming output enables dynamic, real\-time content delivery. It helps reduce user wait\-time anxiety and avoids client\-side timeout failures caused by long\-running inference in complex tasks, ensuring a smooth request workflow.


<Tabs>
<Tab zoneid="BOlXJi320W" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
      "model": "seed-2-0-lite-260228",
      "input": "What are the common cruciferous plants?",
      "thinking":{"type": "enabled"},
      "stream": true
  }'
```


Output example:

```JSON
event: response.created
data: {"type":"response.created","response":{"created_at":1765508936,"id":"resp_021765508935818e7a9c000dd92b8b7b879cbc284c59191ff1d92","max_output_tokens":32768,"model":"seed-2-0-lite-260228","object":"response","thinking":{"type":"enabled"},"service_tier":"default","caching":{"type":"disabled"},"store":true,"expire_at":1765768135},"sequence_number":0}

event: response.in_progress
data: {"type":"response.in_progress","response":{"created_at":1765508936,"id":"resp_021765508935818e7a9c000dd92b8b7b879cbc284c59191ff1d92","max_output_tokens":32768,"model":"seed-2-0-lite-260228","object":"response","thinking":{"type":"enabled"},"service_tier":"default","caching":{"type":"disabled"},"store":true,"expire_at":1765768135},"sequence_number":1}

event: response.output_item.added
data: {"type":"response.output_item.added","output_index":0,"item":{"id":"rs_02176550893661800000000000000000000ffffac150a0f16e055","type":"reasoning","status":"in_progress"},"sequence_number":2}

event: response.reasoning_summary_part.added
data: {"type":"response.reasoning_summary_part.added","item_id":"rs_02176550893661800000000000000000000ffffac150a0f16e055","output_index":0,"summary_index":0,"part":{"type":"summary_text"},"sequence_number":3}

event: response.reasoning_summary_text.delta
data: {"type":"response.reasoning_summary_text.delta","summary_index":0,"delta":"\n","item_id":"rs_02176550893661800000000000000000000ffffac150a0f16e055","output_index":0,"sequence_number":4}

event: response.reasoning_summary_text.delta
data: {"type":"response.reasoning_summary_text.delta","summary_index":0,"delta":"Got","item_id":"rs_02176550893661800000000000000000000ffffac150a0f16e055","output_index":0,"sequence_number":5}

event: response.reasoning_summary_text.delta
data: {"type":"response.reasoning_summary_text.delta","summary_index":0,"delta":" it","item_id":"rs_02176550893661800000000000000000000ffffac150a0f16e055","output_index":0,"sequence_number":6}

event: response.reasoning_summary_text.delta
data: {"type":"response.reasoning_summary_text.delta","summary_index":0,"delta":",","item_id":"rs_02176550893661800000000000000000000ffffac150a0f16e055","output_index":0,"sequence_number":7}

event: response.reasoning_summary_text.delta
data: {"type":"response.reasoning_summary_text.delta","summary_index":0,"delta":" let","item_id":"rs_02176550893661800000000000000000000ffffac150a0f16e055","output_index":0,"sequence_number":8}
...
```



</Tab>
<Tab zoneid="iwIYSQL0IW" title="Python">
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
    thinking={"type": "enabled"},
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


Output example:

```JSON

outPutItem response.output_item.added start:
Got it, let's tackle this question: "What are the common cruciferous plants?" First, I need to remember what cruciferous plants are—they belong to the Brassicaceae family (formerly Cruciferae), named after their four-petaled flowers that look like a cross. 
...
1. Leafy greens: Kale, spinach? Wait no, spinach isn't cruciferous. Oh right, kale is, collard greens, mustard greens, arugula (rocket), watercress, bok choy (pak choi), Swiss chard? No, Swiss chard is Amaranthaceae. Wait, bok choy is Brassica rapa, yes. Also, Brussels sprouts—those are small cabbages. 
...
That should cover the common ones. Let me check if any are missing—maybe kohlrabi is included, yes. Also, make sure the categories are logical. This list is comprehensive but not too long, focusing on the ones people are likely to encounter.
outPutItem response.output_item.added start:
Cruciferous plants belong to the **Brassicaceae family** (formerly Cruciferae), named for their distinctive four-petaled flowers that form a cross shape. They are widely valued for their nutritional richness (high in fiber, vitamins C/K/A, and glucosinolates—compounds linked to antioxidant and anti-inflammatory benefits). Below are common examples, grouped by type:
...
**Answer:** Common cruciferous plants include broccoli, cauliflower, cabbage, Brussels sprouts, kale, collard greens, bok choy, radish, turnip, kohlrabi, arugula, watercress, mustard plants, and rapeseed (canola). They are known for their cross-shaped flowers and high nutritional value.  
\boxed{Broccoli, cauliflower, cabbage, Brussels sprouts, kale, radish, bok choy, turnip}
outPutTextDone.
Response Completed. Usage = {"input_tokens":41,"input_tokens_details":{"cached_tokens":0},"output_tokens":2204,"output_tokens_details":{"reasoning_tokens":1433},"total_tokens":2245,"tool_usage":null,"tool_usage_details":null}
```



</Tab>
<Tab zoneid="J2h4cJzp1x" title="Go">
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

    resp, err := client.CreateResponsesStream(ctx, &responses.ResponsesRequest{
        Model:    "seed-2-0-lite-260228",
        Input:    &responses.ResponsesInput{Union: &responses.ResponsesInput_StringValue{StringValue: "What are the common cruciferous plants?"}},
        Thinking: &responses.ResponsesThinking{Type: responses.ThinkingType_enabled.Enum()},
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


Output example:

```JSON
Got it, let's tackle this question: "What are the common cruciferous plants?" First, I need to remember what cruciferous plants are—they belong to the Brassicaceae family (formerly Cruciferae), named after their four-petaled flowers that look like a cross.
...
Many of these are rich in vitamins (C, K), fiber, and compounds like glucosinolates, which are linked to potential health benefits.
Aggregated reasoning text:
Cruciferous plants belong to the **Brassicaceae family** (formerly called Cruciferae), named for their distinctive four-petaled flowers that form a cross shape. They are widely cultivated for food, with many common vegetables falling into this category. Below are some of the most familiar examples, grouped by type:
...
Aggregated output text: Cruciferous plants belong to the **Brassicaceae family** (formerly called Cruciferae), named for their distinctive four-petaled flowers that form a cross shape. They are widely cultivated for food, with many common vegetables falling into this category. Below are some of the most familiar examples, grouped by type:

### **1. Floret/Head Vegetables**
These are characterized by dense flower heads or layered leaves:
- **Broccoli**: Green, tree-like flower buds on thick stalks.
...
**Answer:** Common cruciferous plants include broccoli, cauliflower, cabbage, Brussels sprouts, kale, bok choy, arugula, radish, turnip, rutabaga, horseradish, kohlrabi, watercress, and mustard plants. These belong to the Brassicaceae family, named for their cross-shaped flowers, and are valued for their nutritional content.
```



</Tab>
<Tab zoneid="zj8TZ1iCJl" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;
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
                .thinking(ResponsesThinking.builder().type(ResponsesConstants.THINKING_TYPE_ENABLED).build())
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


Output example:

```JSON
OutputItem reasoning Start: 
Got it, let's tackle this question: "What are the common cruciferous plants?" First, I need to remember what cruciferous plants are—they belong to the Brassicaceae family (formerly Cruciferae), named after their four-petaled flowers that look like a cross. 
...
OutputItem message Start: 
Cruciferous plants belong to the **Brassicaceae family** (formerly called Cruciferae), named for their distinctive four-petaled flowers that form a cross shape. They are widely cultivated for food, known for their nutrient density (rich in fiber, vitamins C/K/A, and glucosinolates—compounds linked to potential health benefits). Common examples include:
...
\boxed{Broccoli, cauliflower, cabbage, kale, Brussels sprouts, bok choy, radish, turnip, arugula, watercress, kohlrabi, mustard greens, horseradish, wasabi, rapeseed}OutputText End.
OutputItem message End.
Response Completed. Usage = Usage{inputTokens=41, outputTokens=1315, totalTokens=1356, inputTokensDetails=InputTokensDetails{cachedTokens=0}, outputTokensDetails=com.volcengine.ark.runtime.model.responses.usage.OutputTokensDetails@6892b3b6, toolUsage=null, toolUsageDetails=null}
```



</Tab>
<Tab zoneid="NzL6ixex2m" title="OpenAI SDK">
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
    stream=True,
    extra_body={
        "thinking": {"type": "enabled"},
    }
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


Output example:

```JSON

outPutItem response.output_item.added start:
Got it, let's tackle this question: "What are the common cruciferous plants?" First, I need to remember what cruciferous plants are—they belong to the Brassicaceae family (formerly Cruciferae), named after their four-petaled flowers that look like a cross. 
...
1. Leafy greens: Kale, spinach? Wait no, spinach isn't cruciferous. Oh right, kale is, collard greens, mustard greens, arugula (rocket), watercress, bok choy (pak choi), Swiss chard? No, Swiss chard is Amaranthaceae. Wait, bok choy is Brassica rapa, yes. Also, Brussels sprouts—those are small cabbages. 
...
That should cover the common ones. Let me check if any are missing—maybe kohlrabi is included, yes. Also, make sure the categories are logical. This list is comprehensive but not too long, focusing on the ones people are likely to encounter.
outPutItem response.output_item.added start:
Cruciferous plants belong to the **Brassicaceae family** (formerly Cruciferae), named for their distinctive four-petaled flowers that form a cross shape. They are widely valued for their nutritional richness (high in fiber, vitamins C/K/A, and glucosinolates—compounds linked to antioxidant and anti-inflammatory benefits). Below are common examples, grouped by type:
...
**Answer:** Common cruciferous plants include broccoli, cauliflower, cabbage, Brussels sprouts, kale, collard greens, bok choy, radish, turnip, kohlrabi, arugula, watercress, mustard plants, and rapeseed (canola). They are known for their cross-shaped flowers and high nutritional value.  
\boxed{Broccoli, cauliflower, cabbage, Brussels sprouts, kale, radish, bok choy, turnip}
outPutTextDone.
Response Completed. Usage = {"input_tokens":41,"input_tokens_details":{"cached_tokens":0},"output_tokens":2204,"output_tokens_details":{"reasoning_tokens":1433},"total_tokens":2245,"tool_usage":null,"tool_usage_details":null}
```



</Tab>
</Tabs>


<span id="6855e23d"></span>
## Supplement system prompts

In the Responses API, the `instructions` field is used to supplement system prompts in specific rounds. Its core mechanism is to add a system prompt message at the beginning of the dialogue context, enabling more flexible output.

> After configuring the instructions field, caching cannot be written or used \- the `caching` field cannot be set to `{"type": "enabled"}`, and requests with `instructions` will not hit the cache.



<Tabs>
<Tab zoneid="VQFYUdAreT" title="Python">
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

response = client.responses.create(
    model="seed-2-0-lite-260228",    
    input=[
        {
            "role": "system", 
            "content": "You are a math teacher and able to clearly explain the corresponding math problems."
        },
    ]
)
print(response)

second_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=response.id,
    input=[{"role": "user", "content": "Please explain the principle of cosine similarity"}],
)
print(second_response)

third_response = client.responses.create(
    model="seed-2-0-lite-260228",
    instructions="Add a requirement: I hope you can explain this problem in a way that elementary school students can understand.",
    previous_response_id=response.id,
    input=[{"role": "user", "content": "Please explain the principle of cosine similarity"}],
)
print(third_response)
```



</Tab>
<Tab zoneid="FuPYN5WVDz" title="Go">
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

    resp, err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model: "seed-2-0-lite-260228",
        Input: &responses.ResponsesInput{
            Union: &responses.ResponsesInput_ListValue{
                ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{
                    {
                        Union: &responses.InputItem_EasyMessage{
                            EasyMessage: &responses.ItemEasyMessage{
                                Role:    responses.MessageRole_system,
                                Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "You are a math teacher and able to clearly explain the corresponding math problems."}},
                            },
                        },
                    },
                }},
            },
        },
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
                            Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "Please explain the principle of cosine similarity"}},
                        },
                    },
                }}},
            },
        },
    })
    if second_err != nil {
        fmt.Printf("second response error: %v", second_err)
        return
    }
    fmt.Println(second_resp)

    str := "Add a requirement: I hope you can explain this problem in a way that elementary school students can understand."
    third_resp, third_err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model:              "seed-2-0-lite-260228",
        Instructions:       &str,
        PreviousResponseId: &resp.Id,
        Input: &responses.ResponsesInput{
            Union: &responses.ResponsesInput_ListValue{
                ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{{
                    Union: &responses.InputItem_EasyMessage{
                        EasyMessage: &responses.ItemEasyMessage{
                            Role:    responses.MessageRole_user,
                            Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "Please explain the principle of cosine similarity"}},
                        },
                    },
                }}},
            },
        },
    })
    if third_err != nil {
        fmt.Printf("second response error: %v", third_err)
        return
    }
    fmt.Println(third_resp)
}
```



</Tab>
<Tab zoneid="qvF9najZIJ" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;
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

        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .input(ResponsesInput.builder()
                        .addListItem(ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_SYSTEM).content(
                                MessageContent.builder().stringValue("You are a math teacher and able to clearly explain the corresponding math problems.").build()
                        ).build())
                        .build())
                .build();
        ResponseObject resp = arkService.createResponse(request);
        System.out.println(resp);
        System.out.println("---------------------");
        CreateResponsesRequest request2 = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .previousResponseId(resp.getId())
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder().stringValue("Please explain the principle of cosine similarity").build()
                        ).build()
                ).build())
                .build();
        ResponseObject resp2 = arkService.createResponse(request2);
        System.out.println(resp2);
        System.out.println("---------------------");
        CreateResponsesRequest request3 = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .instructions("Add a requirement: I hope you can explain this problem in a way that elementary school students can understand.")
                .previousResponseId(resp.getId())
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder().stringValue("Please explain the principle of cosine similarity").build()
                        ).build()
                ).build())
                .build();
        ResponseObject resp3 = arkService.createResponse(request3);
        System.out.println(resp3);

        arkService.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="mJFKvHhyK1" title="OpenAI SDK">
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

response = client.responses.create(
    model="seed-2-0-lite-260228",    
    input=[
        {
            "role": "system", 
            "content": "You are a math teacher and able to clearly explain the corresponding math problems."
        },
    ]
)
print(response)

second_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=response.id,
    input=[{"role": "user", "content": "Please explain the principle of cosine similarity"}],
)
print(second_response)

third_response = client.responses.create(
    model="seed-2-0-lite-260228",
    instructions="Add a requirement: I hope you can explain this problem in a way that elementary school students can understand.",
    previous_response_id=response.id,
    input=[{"role": "user", "content": "Please explain the principle of cosine similarity"}],
)
print(third_response)
```



</Tab>
</Tabs>


<span id="a1384090"></span>
## Prefill\-based response

By pre\-filling part of the **assistant** role's content, the model is guided and controlled to continue output from existing text fragments, and to maintain consistency in role\-playing scenarios.

<span id="245d7b22"></span>
### Supported models


* seed\-2\-0\-pro\-260328

* seed\-2\-0\-lite\-260228

* seed\-2\-0\-mini\-260215

* seed\-2\-0\-code\-preview\-260328

* seed\-1\-8\-251228


<span id="ad6f6344"></span>
### Key configuration

In the `input` list, set the role of the last message to `assistant`, and set partial to `true` to turn on the prefill\-based response mode. The model will continue to generate content based on the value of the `content` field.

```Python
"input": [
    {"role": "user", "content": "Please write bubble sort code without any additional content."},
    {"role": "assistant", "content": "def bubble_sort(arr):", "partial": true} 
]
```


<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">Note</div>


<div data-tips="true" data-tips-type="warning">When using prefill\-based response, note the following:</div>



* <div data-tips="true" data-tips-type="warning">For a new round of input, you can set the <strong>content</strong> of the <code>assistant</code> role to empty for prefill, so that the model can generate continuous responses across multiple rounds.</div>


* <div data-tips="true" data-tips-type="warning">Prefix caching and session caching are supported. When using session caching, both cache storage and cache hits in the next round are calculated as <strong>tokens</strong> of the current round of input.</div>


* <div data-tips="true" data-tips-type="warning">Structured output (<strong>json_object</strong> mode and <strong>json_schema</strong> mode) is not supported.</div>


* <div data-tips="true" data-tips-type="warning">It is not recommended to use it together with built\-in tools, because the prefill\-based response will fail to generate as the <strong>content</strong> cannot be used as the starting content of the final output if large model calls and tool calls are intertwined.</div>



<span id="20bcc621"></span>
### Usage examples

<span id="fbf520e7"></span>
#### Code completion

The following are examples of using prefill to continue the code for the bubble sort algorithm. After enabling prefill\-based response, the model will continue to write after `"def bubble_sort(arr):"`.


<Tabs>
<Tab zoneid="bCFYu3N2mf" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
      "model": "seed-1-8-251228",
      "input": [
          {"role": "user", "content": "Please write bubble sort code without any additional content."},
          {"role": "assistant", "content": "def bubble_sort(arr):", "partial": true} 
      ],
      "caching": {"type": "disabled"}
  }'
```



</Tab>
<Tab zoneid="TJ7ucDkKwn" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
from byteplussdkarkruntime import Ark

client = Ark(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=os.getenv('ARK_API_KEY'),
)

response = client.responses.create(
    model="seed-2-0-lite-260228",
    input=[
        {"role": "user", "content": "Please write bubble sort code without any additional content."},
        {"role": "assistant", "content": "def bubble_sort(arr):", "partial": True}
    ],
    caching={"type": "disabled"}
)
print(response)
```



</Tab>
<Tab zoneid="RIzebYfQ2B" title="Go">
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
    partial := true

    inputMessage := &responses.InputItemList{ListValue: []*responses.InputItem{
        {
            Union: &responses.InputItem_EasyMessage{
                EasyMessage: &responses.ItemEasyMessage{
                    Role:    responses.MessageRole_user,
                    Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "Please write bubble sort code without any additional content."}},
                },
            },
        },
        {
            Union: &responses.InputItem_EasyMessage{
                EasyMessage: &responses.ItemEasyMessage{
                    Role:    responses.MessageRole_assistant,
                    Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "def bubble_sort(arr):"}},
                    Partial: &partial,
                },
            },
        },
    }}
    
    resp, err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model: "seed-2-0-lite-260228",
        Input: &responses.ResponsesInput{
            Union: &responses.ResponsesInput_ListValue{
                ListValue: inputMessage,
            },
        },
        Caching: &responses.ResponsesCaching{Type: responses.CacheType_disabled.Enum()},
    })
    if err != nil {
        fmt.Printf("response error: %v\\n", err)
        return
    }
    fmt.Println(resp)
}
```



</Tab>
<Tab zoneid="AcN3aZcffd" title="Java">
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

public class demo {
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        ArkService arkService = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .input(ResponsesInput.builder()
                        .addListItem(ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder().stringValue("Please write bubble sort code without any additional content.").build()
                        ).build())
                        .addListItem(ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_ASSISTANT).content(
                                MessageContent.builder().stringValue("def bubble_sort(arr):").build()
                        ).partial(true).build())
                        .build())
                .caching(ResponsesCaching.builder().type("disabled").build())
                .build();
        ResponseObject resp = arkService.createResponse(request);
        System.out.println(resp);

        arkService.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="bizgLSW2yf" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
import os
from openai import OpenAI

client = OpenAI(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=os.getenv('ARK_API_KEY'),
)

response = client.responses.create(
    model="seed-2-0-lite-260228",
    input=[
        {"role": "user", "content": "Please write bubble sort code without any additional content."},
        {"role": "assistant", "content": "def bubble_sort(arr):", "partial": True}
    ],
    extra_body={
        "caching": {"type": "disabled"}
    }
)
print(response)
```



</Tab>
</Tabs>


Response example:

> The model continues to write after "def bubble_sort(arr):" in the similar format and convention.


```Bash
n = len(arr)
for i in range(n):
    swapped = False
    for j in range(0, n-i-1):
        if arr[j] > arr[j+1]:
            arr[j], arr[j+1] = arr[j+1], arr[j]
            swapped = True
    if not swapped:
        break
return arr
```


<span id="c50aa353"></span>
#### Context caching

The following is a cURL code sample of how to use context caching in prefill\-based response. For other SDK code samples, see [Context caching (Responses API)](https://docs.byteplus.com/en/docs/ModelArk/1602228).


* Create prefix cache while using prefill\-based response.


The input content must be at least 256 tokens, otherwise the prefix cache cannot be created.

```Plain Text
```PowerShell
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "seed-2-0-lite-260228",
    "input":[
        {
            "role": "system",
            "content": "You are Dola, <prompt_content>"
        },
        {
            "role": "user",
            "content": "What is your favorite food?"
        },
        {
            "role": "assistant",
            "content": "Tomatoes"
        },
        {
            "role": "user",
            "content": "What else?"
        },
        {
            "role": "assistant",
            "content": "Hamburgers",
            "partial":true
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
```



* Create session cache while using prefill\-based response. Read and use the prefix cache via the ID returned by the previous request.

   ```PowerShell
   curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \
     -H "Authorization: Bearer $ARK_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "model": "seed-2-0-lite-260228",
       "input":[
           {
               "role": "assistant",
               "content": "Apple pie"
           },
           {
               "role": "assistant",
               "content": "",
               "partial":true
           }
       ],
       "previous_response_id": "<id>",
       "caching":{
           "type":"enabled"
       },
       "thinking": {
           "type": "disabled"
       }
     }'
   ```
   


<span id="abd1d689"></span>
## How context management works

The context management process is as follows:

<span>![图片](https://asset.ark-doc-resources.com/flowcharts/responses-api/text-generation-02.svg) </span>


* item: A message from any role, including system information, user information, model information, chain\-of\-thought information, tool information, and so on.

* response_id: Represents the input item and answer item for the current request round.

* Input item: The item referred to by previous_response_id plus the new input item for this round. Previous rounds of dialogue are linked in the form of a linked list to form new input.


<span id="7c5190d3"></span>
## Notes on storage

Storage is enabled by default. You can explicitly enable it by setting `"store": true`, or disable it by setting `"store": false`.


* Storage conditions: If the reply for this request is completed successfully (the **status** field returns `completed`), or if the reply is truncated due to a length limit (**status** field is `incomplete`), the record for this round will be stored. If the chain\-of\-thought content is truncated due to a length limit, the **output** will be empty when querying the model response.

* Input limit: Up to 1000 items are supported (one message from any role counts as one item; for example, one question and one answer count as two items). When this limit is reached, the conversation cannot continue. You can manually clear records by using the delete model request interface (/en/docs/ModelArk/1584286).

* Storage duration: By default, data is stored for 3 days. You can customize this using the **expire_at** field, with a maximum supported duration of 7 days.

* Storage content: Stores information in the **input** and **output** fields; chain\-of\-thought content is not stored.

* Other notes: The store feature is currently free of charge; data is encrypted to ensure security & privacy compliance.


<span id="75add7b8"></span>
## QPS rate limits

Responses API QPS rate limiting is as follows. To increase the rate limiting value, please submit a [Ticket](https://console.byteplus.com/workorder/create?step=2&SubProductID=P00001514).


|API |Account\-level QPS rate limit |
|---|---|
|Create model response |None |
|Query model response |20 |
|List input items |20 |
|Delete model response |20 |


 &nbsp;



