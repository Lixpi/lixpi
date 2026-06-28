Some large models with image understanding capabilities support image input via local files and image URLs, and are suitable for scenarios such as image description, classification, and visual grounding.

<span id="18cf565a"></span>
# Quick start

Experiment with the following Responses API code samples, and see how image understanding works by passing images via URL.


<span aceTableMode="list" aceTableWidth="1,1"></span>
|Input |Output Preview |
|---|---|
|<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/16acff92a12f4518b1ae63b52d8b6d81~tplv-goo7wpa0wc-image.image) </span><br><br>> Based on the image, how many planets are listed in the table, and which row contains Earth? |* Reasoning: Got it, let's answer this step by step. First count the planets: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune. That's 8 planets total, which matches the description saying 8 planets. Then Earth is the 3rd row, after Mercury (1st) and Venus (2nd), right? Let's confirm: first row after headers is Mercury (row 1 of data), Venus (row 2), Earth is the 3rd data row (the 4th row overall in the table, including the header row)...<br><br>* Answer:<br><br>   First, there are 8 planets listed in the table, matching the description that the table covers all eight solar system planets. Earth is the third data row of the table (the fourth full table row, if you count the column header row as the first row), it sits between the Venus row and the Mars row, with its volume (Earth=1) marked as 1.00, and its distance from the Sun as 149.6 million km. |



<Tabs>
<Tab zoneid="Qlgi1lgU8z" title="Python">
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
        {
            "role": "user",
            "content": [
                {
                    "type": "input_image",
                    "image_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png"
                },
                {
                    "type": "input_text",
                    "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"
                },
            ],
        }
    ]
)

print(response)
```



</Tab>
<Tab zoneid="TgmUvVMptm" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
-H "Authorization: Bearer $ARK_API_KEY" \\
-H 'Content-Type: application/json' \\
-d '{
    "model": "seed-2-0-lite-260228",
    "input": [
        {
            "role": "user",
            "content": [
                {
                    "type": "input_image",
                    "image_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png"
                },
                {
                    "type": "input_text",
                    "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"
                }
            ]
        }
    ]
}'
```



</Tab>
<Tab zoneid="lko7VKKwHZ" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"    
    "github.com/samber/lo"
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

    inputMessage := &responses.ItemInputMessage{
        Role: responses.MessageRole_user,
        Content: []*responses.ContentItem{
            {
                Union: &responses.ContentItem_Image{
                    Image: &responses.ContentItemImage{
                        Type:     responses.ContentItemType_input_image,
                        ImageUrl: lo.ToPtr("https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png"),
                    },
                },
            },
            {
                Union: &responses.ContentItem_Text{
                    Text: &responses.ContentItemText{
                        Type: responses.ContentItemType_input_text,
                        Text: "Based on the image, how many planets are listed in the table, and which row contains Earth?",
                    },
                },
            },
        },
    }

    resp, err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model: "seed-2-0-lite-260228",
        Input: &responses.ResponsesInput{
            Union: &responses.ResponsesInput_ListValue{
                ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{{
                    Union: &responses.InputItem_InputMessage{
                        InputMessage: inputMessage,
                    },
                }}},
            },
        },
    })
    if err != nil {
        fmt.Printf("response error: %v\n", err)
        return
    }
    fmt.Println(resp)
}
```



</Tab>
<Tab zoneid="e1JNIOTYlI" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.model.responses.request.*;
import com.byteplus.ark.runtime.model.responses.content.*;
import com.byteplus.ark.runtime.model.responses.item.*;
import com.byteplus.ark.runtime.model.responses.response.ResponseObject;
import com.byteplus.ark.runtime.model.responses.constant.ResponsesConstants;

public class demo {
  public static void main(String[] args) {
    String apiKey = System.getenv("ARK_API_KEY");
    ArkService arkService = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3")
        .build();

    CreateResponsesRequest request = CreateResponsesRequest.builder()
        .model("seed-2-0-lite-260228")
        .input(ResponsesInput.builder().addListItem(
            ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                MessageContent.builder()
                    .addListItem(InputContentItemImage.builder()
                        .imageUrl("https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png").build())
                    .addListItem(InputContentItemText.builder().text("Based on the image, how many planets are listed in the table, and which row contains Earth?").build())
                    .build())
                .build())
            .build())
        .build();
    ResponseObject resp = arkService.createResponse(request);
    System.out.println(resp);

    arkService.shutdownExecutor();
  }
}
```



</Tab>
<Tab zoneid="fy2GKJLxZJ" title="OpenAI SDK">
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
        {
            "role": "user",
            "content": [
                {
                    "type": "input_image",
                    "image_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png"
                },
                {
                    "type": "input_text",
                    "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"
                },
            ],
        }
    ]
)

print(response)
```



</Tab>
</Tabs>


<span id="f8d6cc48"></span>
# Models and APIs

Supported models:


* See [Visual understanding](https://docs.byteplus.com/en/docs/ModelArk/1330310#ff5ef604).

   Supported APIs:

* [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request): Supports image input. Supports understanding images specified via filepath. For usage, see [Upload via filepath (recommended)](https://docs.byteplus.com/en/docs/ModelArk/1362931#2c38c01b).

* [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384): Supports image input.


<span id="547c81e8"></span>
# Image input methods

The supported image input methods are as follows:


* Uploading local files:

   * [Upload via filepath (recommended)](https://docs.byteplus.com/en/docs/ModelArk/1362931#2c38c01b): Directly pass the local filepath. The file size cannot exceed 512 MB.

   * [Pass Base64 string](https://docs.byteplus.com/en/docs/ModelArk/1362931#477e51ce): Suitable for images smaller than 10 MB, and the request body cannot exceed 64 MB.

* [Pass image URL](https://docs.byteplus.com/en/docs/ModelArk/1362931#d86010f4): Suitable for images publicly accessible through URLs and smaller than 10 MB.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">Chat API is stateless. If you want the model to perform multi\-turn understanding on an image, you must pass that image in each request.</div>


<span id="dbbdddbe"></span>
## Upload local files

<span id="2c38c01b"></span>
### Upload via filepath (recommended)

Uploading local files via the filepath is recommended, because it supports files up to 512 MB. (Currently supported by Responses API)

When you pass the local filepath to the model, it will call Files API to upload the file and call Responses API to analyze it. Only the Python SDK and Go SDK support this method. Detailed examples are as follows:


> * If you need to obtain analysis in real time or avoid client timeout failures caused by complex tasks, you can use the streaming output. For usage, see [Example request](https://docs.byteplus.com/en/docs/ModelArk/2123275#9346c907).

> * Supports direct upload of local files using the Files API. For details, see [Files API tutorial](https://docs.byteplus.com/en/docs/ModelArk/1885708).



<Tabs>
<Tab zoneid="Xx7x4JH7pW" title="Python">
<TabTitle>Python</TabTitle>

```Python
import asyncio
import os
from byteplussdkarkruntime import AsyncArk

client = AsyncArk(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=os.getenv('ARK_API_KEY')
)
async def main():
    local_path = "/Users/doc/planet_comparison.png"
    response = await client.responses.create(
        model="seed-2-0-lite-260228",
        input=[
            {"role": "user", "content": [
                {
                    "type": "input_image",
                    "image_url": f"file://{local_path}"  
                },
                {
                    "type": "input_text",
                    "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"
                }
            ]},
        ]
    )
    print(response)
if __name__ == "__main__":
    asyncio.run(main())
```



</Tab>
<Tab zoneid="NhhDKOdMhd" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main
import (
    "context"
    "fmt"
    "os"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/responses"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)
func main() {
    client := arkruntime.NewClientWithApiKey(
        // Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
        os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    ctx := context.Background()
    localPath := "/Users/doc/planet_comparison.png"
    imagePath := "file://" + localPath
    inputMessage := &responses.ItemInputMessage{
        Role: responses.MessageRole_user,
        Content: []*responses.ContentItem{
            {
                Union: &responses.ContentItem_Image{
                    Image: &responses.ContentItemImage{
                        Type:     responses.ContentItemType_input_image,
                        ImageUrl: byteplus.String(imagePath),
                    },
                },
            },
            {
                Union: &responses.ContentItem_Text{
                    Text: &responses.ContentItemText{
                        Type: responses.ContentItemType_input_text,
                        Text: "Based on the image, how many planets are listed in the table, and which row contains Earth?",
                    },
                },
            },
        },
    }
    createResponsesReq := &responses.ResponsesRequest{
        Model: "seed-2-0-lite-260228",
        Input: &responses.ResponsesInput{
            Union: &responses.ResponsesInput_ListValue{
                ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{{
                    Union: &responses.InputItem_InputMessage{
                        InputMessage: inputMessage,
                    },
                }}},
            },
        },
    }
    resp, err := client.CreateResponses(ctx, createResponsesReq)
    if err != nil {
        fmt.Printf("stream error: %v\n", err)
        return
    }
    fmt.Println(resp)
}
```



</Tab>
</Tabs>


<span id="477e51ce"></span>
### Pass Base64 string

Convert the local file to a Base64 encoded string and submit it to the large model. This method is suitable for images smaller than 10 MB, and the request body cannot exceed 64 MB. (Supported by both Responses API and Chat API)

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">Note</div>


<div data-tips="true" data-tips-type="warning">Convert the image file to a Base64 encoded string, concatenate it in the format <code>data:{mime_type};base64,{base64_data}</code>, and pass it to the model.</div>



* <div data-tips="true" data-tips-type="warning"><code>{mime_type}</code>: The media type of the file, which must be identical to the file's mime_type. For details about supported image formats, see <a href="https://docs.byteplus.com/en/docs/ModelArk/1362931#51efc45f">Supported image formats</a>.</div>


* <div data-tips="true" data-tips-type="warning"><code>{base64_data}</code>: The Base64 encoded string of the file.</div>




<span aceTableMode="list" aceTableWidth="5,5"></span>
|[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request) |
|---|---|
|```Python```<br>```...```<br>```model="seed-2-0-lite-260228",```<br>```messages=[```<br>```    {```<br>```        "role": "user",```<br>```        "content": [```<br>```            {```<br>```                "type": "image_url",```<br>```                "image_url": {```<br>```                    "url": f"data:image/png;base64,{base64_image}"```<br>```                }```<br>```            },```<br>```            {```<br>```                "type": "text",```<br>```                "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"```<br>```            }```<br>```        ]```<br>```    }```<br>```]```<br>```...```<br> |```Python```<br>```...```<br>```model="seed-2-0-lite-260228",```<br>```input=[```<br>```    {```<br>```        "role": "user",```<br>```        "content": [```<br>```            {```<br>```                "type": "input_image",```<br>```                "image_url": f"data:image/png;base64,{base64_image}"```<br>```            },```<br>```            {```<br>```                "type": "input_text",```<br>```                "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"```<br>```            }```<br>```        ]```<br>```    }```<br>```]```<br>```...```<br> |



* Responses API code samples:

   
   <Tabs>
   <Tab zoneid="Ed8QruO3SQ" title="Curl">
   <TabTitle>Curl</TabTitle>
   
   ```Bash
   BASE64_IMAGE=$(base64 < demo.png) && curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
      -H "Content-Type: application/json"  \\
      -H "Authorization: Bearer $ARK_API_KEY"  \\
      -d @- <<EOF
      {
       "model": "seed-2-0-lite-260228",
       "input": [
         {
           "role": "user",
           "content": [
             {
               "type": "input_image",
               "image_url": "data:image/png;base64,$BASE64_IMAGE"
             },
             {
               "type": "input_text",
               "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"
             }
           ]
         }
       ]
     }
   EOF
   ```
   
   
   
   </Tab>
   <Tab zoneid="n0UGvxA1u0" title="Python">
   <TabTitle>Python</TabTitle>
   
   ```Python
   import os
   from byteplussdkarkruntime import Ark
   import base64
   # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
   api_key = os.getenv('ARK_API_KEY')
   
   client = Ark(
       base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
       api_key=api_key,
   )
   # Convert local files to Base64-encoded strings.
   def encode_file(file_path):
     with open(file_path, "rb") as read_file:
       return base64.b64encode(read_file.read()).decode('utf-8')
   base64_file = encode_file("/Users/doc/demo.png")
   
   response = client.responses.create(
       model="seed-2-0-lite-260228",
       input=[
           {
               "role": "user",
               "content": [
   
                   {
                       "type": "input_image",
                       "image_url": f"data:image/png;base64,{base64_file}"
                   },
                   {
                       "type": "input_text",
                       "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"
                   },
               ],
           }
       ]
   )
   
   print(response)
   ```
   
   
   
   </Tab>
   <Tab zoneid="P9fQ3wgEBA" title="Go">
   <TabTitle>Go</TabTitle>
   
   ```Go
   package main
   
   import (
       "context"
       "encoding/base64"
       "fmt"
       "os"
   
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/responses"
   )
   
   func main() {
       // Convert local files to Base64-encoded strings.
       fileBytes, err := os.ReadFile("/Users/doc/demo.png") 
       if err != nil {
           fmt.Printf("read file error: %v\\n", err)
           return
       }
       base64File := base64.StdEncoding.EncodeToString(fileBytes)
       client := arkruntime.NewClientWithApiKey(
           os.Getenv("ARK_API_KEY"),
           arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
       )
       ctx := context.Background()
   
       inputMessage := &responses.ItemInputMessage{
           Role: responses.MessageRole_user,
           Content: []*responses.ContentItem{
               {
                   Union: &responses.ContentItem_Image{
                       Image: &responses.ContentItemImage{
                           Type:     responses.ContentItemType_input_image,
                           ImageUrl: fmt.Sprintf("data:image/png;base64,%s", base64File),
                       },
                   },
               },
               {
                   Union: &responses.ContentItem_Text{
                       Text: &responses.ContentItemText{
                           Type: responses.ContentItemType_input_text,
                           Text: "Based on the image, how many planets are listed in the table, and which row contains Earth?",
                       },
                   },
               },
           },
       }
   
       resp, err := client.CreateResponses(ctx, &responses.ResponsesRequest{
           Model: "seed-2-0-lite-260228",
           Input: &responses.ResponsesInput{
               Union: &responses.ResponsesInput_ListValue{
                   ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{{
                       Union: &responses.InputItem_InputMessage{
                           InputMessage: inputMessage,
                       },
                   }}},
               },
           },
       })
       if err != nil {
           fmt.Printf("response error: %v\\n", err)
           return
       }
       fmt.Println(resp)
   }
   ```
   
   
   
   </Tab>
   <Tab zoneid="fO6eAUbaxq" title="Java">
   <TabTitle>Java</TabTitle>
   
   ```Java
   package com.ark.sample;
   import com.byteplus.ark.runtime.model.responses.content.InputContentItemImage;
   import com.byteplus.ark.runtime.model.responses.content.InputContentItemText;
   import com.byteplus.ark.runtime.model.responses.item.ItemEasyMessage;
   import com.byteplus.ark.runtime.service.ArkService;
   import com.byteplus.ark.runtime.model.responses.request.*;
   import com.byteplus.ark.runtime.model.responses.response.ResponseObject;
   import com.byteplus.ark.runtime.model.responses.constant.ResponsesConstants;
   import com.byteplus.ark.runtime.model.responses.item.MessageContent;
   import java.nio.file.Files;
   import java.nio.file.Paths;
   import java.util.Base64;
   import java.io.IOException;
   
   public class demo {
       private static String encodeFile(String filePath) throws IOException {
           byte[] fileBytes = Files.readAllBytes(Paths.get(filePath));
           return Base64.getEncoder().encodeToString(fileBytes);
       }
       public static void main(String[] args) {
           String apiKey = System.getenv("ARK_API_KEY");
           ArkService arkService = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();
           // Convert local files to Base64-encoded strings.
           String base64Data = "";
           try {
               base64Data = "data:image/png;base64," + encodeFile("/Users/demo.png");
           } catch (IOException e) {
               System.err.println("encode error: " + e.getMessage());
           }
           CreateResponsesRequest request = CreateResponsesRequest.builder()
                   .model("seed-2-0-lite-260228")
                   .input(ResponsesInput.builder().addListItem(
                           ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                   MessageContent.builder()
                                           .addListItem(InputContentItemImage.builder().imageUrl(base64Data).build())
                                           .addListItem(InputContentItemText.builder().text("Based on the image, how many planets are listed in the table, and which row contains Earth?").build())
                                           .build()
                           ).build()
                   ).build())
                   .build();
           ResponseObject resp = arkService.createResponse(request);
           System.out.println(resp);
   
           arkService.shutdownExecutor();
       }
   }
   ```
   
   
   
   </Tab>
   <Tab zoneid="veE1WiVPdC" title="OpenAI SDK">
   <TabTitle>OpenAI SDK</TabTitle>
   
   ```Python
   import os
   from openai import OpenAI
   import base64
   api_key = os.getenv('ARK_API_KEY')
   
   client = OpenAI(
       base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
       api_key=api_key,
   )
   # Convert local files to Base64-encoded strings.
   def encode_file(file_path):
     with open(file_path, "rb") as read_file:
       return base64.b64encode(read_file.read()).decode('utf-8')
   base64_file = encode_file("/Users/doc/demo.png")
   
   response = client.responses.create(
       model="seed-2-0-lite-260228",
       input=[
           {
               "role": "user",
               "content": [
   
                   {
                       "type": "input_image",
                       "image_url": f"data:image/png;base64,{base64_file}",
                   },
                   {
                       "type": "input_text",
                       "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"
                   },
               ],
           }
       ]
   )
   
   print(response)
   ```
   
   
   
   </Tab>
   </Tabs>
   

* Chat API code samples:

   
   <Tabs>
   <Tab zoneid="Ryk8o3vnd4" title="Curl">
   <TabTitle>Curl</TabTitle>
   
   ```Bash
   BASE64_IMAGE=$(base64 < demo.png) && curl https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions \\
      -H "Content-Type: application/json"  \\
      -H "Authorization: Bearer $ARK_API_KEY"  \\
      -d @- <<EOF
      {
       "model": "seed-2-0-lite-260228",
       "messages": [
         {
           "role": "user",
           "content": [
             {
               "type": "image_url",
               "image_url": {
                 "url": "data:image/png;base64,$BASE64_IMAGE"
               }
             },
             {
               "type": "text",
               "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"
             }
           ]
         }
       ],
       "max_tokens": 300
     }
   EOF
   ```
   
   
   
   </Tab>
   <Tab zoneid="Bwt41r8MbF" title="Python">
   <TabTitle>Python</TabTitle>
   
   ```Python
   import base64
   import os
   # Install SDK:pip install byteplus-python-sdk-v2
   from byteplussdkarkruntime import Ark 
   
   client = Ark(
       #The base URL for model invocation
       base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
       # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
       api_key=os.getenv('ARK_API_KEY'), 
   )
   
   # Define a method to convert the image at the specified path to Base64 string
   def encode_image(image_path):
     with open(image_path, "rb") as image_file:
       return base64.b64encode(image_file.read()).decode('utf-8')
   
   # Image to be passed to the large model
   image_path = "demo.png"
   
   # Convert the image to Base64 string
   base64_image = encode_image(image_path)
   
   completion = client.chat.completions.create(
     #Replace with Model ID
     model = "seed-2-0-lite-260228",
     messages=[
       {
         "role": "user",
         "content": [
           {
             "type": "image_url",
             "image_url": {
             # Note: The Base64 string must be in the format: data:image/<IMAGE_FORMAT>;base64,{base64_image}:
             # PNG images: "url": f"data:image/png;base64,{base64_image}"
             # JPEG images: "url": f"data:image/jpeg;base64,{base64_image}"
             # WEBP images: "url": f"data:image/webp;base64,{base64_image}"
               "url":  f"data:image/<IMAGE_FORMAT>;base64,{base64_image}"
             },         
           },
           {
             "type": "text",
             "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?",
           },
         ],
       }
     ],
   )
   
   print(completion.choices[0])
   ```
   
   
   
   </Tab>
   <Tab zoneid="Ysc4Y4cloC" title="Go">
   <TabTitle>Go</TabTitle>
   
   ```Go
   package main
   
   import (
       "context"
       "encoding/base64"
       "fmt"
       "os"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
   )
   
   func main() {
       // Read local image file
       imageBytes, err := os.ReadFile("demo.png") // Replace with actual image path
       if err != nil {
           fmt.Printf("Fail to read image: %v\\n", err)
           return
       }
       base64Image := base64.StdEncoding.EncodeToString(imageBytes)
   
       client := arkruntime.NewClientWithApiKey(
           os.Getenv("ARK_API_KEY"),
           //The base URL for model invocation
           arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
           )
       ctx := context.Background()
       req := model.CreateChatCompletionRequest{
           //Replace with Model ID
           Model: "seed-2-0-lite-260228",
           Messages: []*model.ChatCompletionMessage{
               {
                   Role: "user",
                   Content: &model.ChatCompletionMessageContent{
                       ListValue: []*model.ChatCompletionMessageContentPart{
                           {
                               Type: "image_url",
                               ImageURL: &model.ChatMessageImageURL{
                                   URL: fmt.Sprintf("data:image/png;base64,%s", base64Image),
                               },
                           },
                           {
                               Type: "text",
                               Text: "Based on the image, how many planets are listed in the table, and which row contains Earth?",
                           },
                       },
                   },
               },
           },
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
   <Tab zoneid="p0XSRZjNTs" title="Java">
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
   import java.nio.file.Files;
   import java.nio.file.Path;
   import java.util.Base64;
   import java.io.IOException;
   
   public class Sample {
       static String apiKey = System.getenv("ARK_API_KEY");
       static ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
       static Dispatcher dispatcher = new Dispatcher();
       static ArkService service = ArkService.builder()
            .dispatcher(dispatcher)
            .connectionPool(connectionPool)
            .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3") //The base URL for model invocation
            .apiKey(apiKey)
            .build();
   
       // Base64 encoding method
       private static String encodeImage(String imagePath) throws IOException {
           byte[] imageBytes = Files.readAllBytes(Path.of(imagePath));
           return Base64.getEncoder().encodeToString(imageBytes);
       }
   
       public static void main(String[] args) throws Exception {
   
           List<ChatMessage> messagesForReqList = new ArrayList<>();
   
           // Local image path (replace with actual path)
           String imagePath = "demo.png";
   
           // Generate Base64 URL
           String base64Data = "data:image/png;base64," + encodeImage(imagePath);
   
           // Build message content (fix content part construction method)
           List<ChatCompletionContentPart> contentParts = new ArrayList<>();
   
           // Use builder pattern for the image part
           contentParts.add(ChatCompletionContentPart.builder()
                    .type("image_url")
                    .imageUrl(new ChatCompletionContentPartImageURL(base64Data))
                    .build());
   
           // Use builder pattern for the text part
           contentParts.add(ChatCompletionContentPart.builder()
                    .type("text")
                    .text("Based on the image, how many planets are listed in the table, and which row contains Earth?")
                    .build());
   
           // Create message
           messagesForReqList.add(ChatMessage.builder()
                    .role(ChatMessageRole.USER)
                    .multiContent(contentParts)
                    .build());
   
           ChatCompletionRequest req = ChatCompletionRequest.builder()
                    .model("seed-2-0-lite-260228") //Replace with Model ID  .
                    .messages(messagesForReqList)
                    .maxTokens(300)
                    .build();
   
           service.createChatCompletion(req)
                    .getChoices()
                    .forEach(choice -> System.out.println(choice.getMessage().getContent()));
           // Shutdown service after all requests are finished
           service.shutdownExecutor();
       }
   }
   ```
   
   
   
   </Tab>
   </Tabs>
   


<span id="d86010f4"></span>
## Pass image URL

If the image already has a publicly accessible URL, you can directly fill in the public URL of the image in the request. A single image cannot exceed 10 MB. (Supported by both Responses API and Chat API.)

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">If you use a URL, it is recommended to store the image using BytePlus Torch Object Storage (TOS) and generate an access link. This not only ensures stable storage of the image but also leverages the internal network communication advantage between ModelArk and TOS, effectively reducing model response latency and public network traffic costs.</div>



<span aceTableMode="list" aceTableWidth="5,5"></span>
|[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request) |
|---|---|
|```Python```<br>```...```<br>```model="seed-2-0-lite-260228",```<br>```messages=[```<br>```    {```<br>```        "role": "user",```<br>```        "content": [```<br>```            {```<br>```                "type": "image_url",```<br>```                "image_url": {```<br>```                    "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png"```<br>```                }```<br>```            },```<br>```            {```<br>```                "type": "text",```<br>```                "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"```<br>```            }```<br>```        ]```<br>```    }```<br>```]```<br>```...```<br> |```Python```<br>```...```<br>```model="seed-2-0-lite-260228",```<br>```input=[```<br>```    {```<br>```        "role": "user",```<br>```        "content": [```<br>```            {```<br>```                "type": "input_image",```<br>```                "image_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png"```<br>```            },```<br>```            {```<br>```                "type": "input_text",```<br>```                "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"```<br>```            }```<br>```        ]```<br>```    }```<br>```]```<br>```...```<br> |



* Responses API code samples: [Quick start](https://docs.byteplus.com/en/docs/ModelArk/1362931#18cf565a)

* Chat API code samples:

   
   <Tabs>
   <Tab zoneid="NRQrVkr25A" title="Curl">
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
               {"type": "image_url","image_url": {"url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png"}},
                   {"type": "text", "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"}
               ]
           }
       ],
       "max_tokens": 300
     }'
   ```
   
   
   
   </Tab>
   <Tab zoneid="p0GUmgpmK5" title="Python">
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
           {
               "role": "user",
               "content": [                
               {"type": "image_url","image_url": {"url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png"}},
                   {"type": "text", "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"},
               ],
           }
       ],
   )
   
   print(completion.choices[0])
   ```
   
   
   
   </Tab>
   <Tab zoneid="EVmb1F39CG" title="Go">
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
           //Use os.Getenv to get ARK_API_KEY
           os.Getenv("ARK_API_KEY"),
           //The base URL for model invocation
           arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
       )
       // Create a context background
       ctx := context.Background()
       // Construct the content of the message
       contentParts := []*model.ChatCompletionMessageContentPart{
           // Image
           {
               Type: "image_url",
               ImageURL: &model.ChatMessageImageURL{
               URL: "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png"
               },
           },
           // Text
           {
               Type: "text",
               Text: "Based on the image, how many planets are listed in the table, and which row contains Earth? ",
           },
       }
       // Construct chat, specify model and message
       req := model.CreateChatCompletionRequest{
           //Replace with Model ID
          Model: "seed-2-0-lite-260228",
          Messages: []*model.ChatCompletionMessage{
             {
                // Set message role as user
                Role: model.ChatMessageRoleUser,
                Content: &model.ChatCompletionMessageContent{
                   ListValue: contentParts,
                },
             },
          },
       }
   
       // Send chat, store result in resp and any possible error in err
       resp, err := client.CreateChatCompletion(ctx, req)
       if err!= nil {
          fmt.Printf("standard chat error: %v\\n", err)
          return
       }
       // Print response
       fmt.Println(*resp.Choices[0].Message.Content.StringValue)
   }
   ```
   
   
   
   </Tab>
   <Tab zoneid="VKxOgX1aot" title="Java">
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
     static ArkService service = ArkService.builder()
          .dispatcher(dispatcher)
          .connectionPool(connectionPool)
          .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3")  //The base URL for model invocation  .
          .apiKey(apiKey)
          .build();
   
     public static void main(String[] args) throws Exception {
   
       List<ChatMessage> messagesForReqList = new ArrayList<>();
   
       // Construct the content of the message
       List<ChatCompletionContentPart> contentParts = new ArrayList<>();
   
       // Use builder mode for the image
       contentParts.add(ChatCompletionContentPart.builder()
            .type("image_url")
            .imageUrl(new ChatCompletionContentPartImageURL(
           "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png"))
            .build());
   
       // Use builder mode for text
       contentParts.add(ChatCompletionContentPart.builder()
            .type("text")
            .text("Based on the image, how many planets are listed in the table, and which row contains Earth? ")
            .build());
   
       // Create message
       messagesForReqList.add(ChatMessage.builder()
            .role(ChatMessageRole.USER)
            .multiContent(contentParts)
            .build());
   
       ChatCompletionRequest req = ChatCompletionRequest.builder()
            .model("seed-2-0-lite-260228") //Replace with Model ID  .
            .messages(messagesForReqList)
            .build();
   
       service.createChatCompletion(req)
            .getChoices()
            .forEach(choice -> System.out.println(choice.getMessage().getContent()));
       // shutdown service after all requests are finished
       service.shutdownExecutor();
     }
   }
   ```
   
   
   
   </Tab>
   </Tabs>
   


<span id="2d7ef2c7"></span>
# Use cases

<span id="594387aa"></span>
## Multi\-image input

The API supports accepting and processing multiple image inputs. These images can be passed to the model via accessible URLs or converted Base64 strings. The model will combine information from all passed images to answer questions.


* Responses API code samples:

   
   <Tabs>
   <Tab zoneid="nEqwyvMLKL" title="Curl">
   <TabTitle>Curl</TabTitle>
   
   ```Bash
   curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
     -H "Authorization: Bearer $ARK_API_KEY" \\
     -H "Content-Type: application/json" \\
     -d '{
       "model": "seed-2-0-lite-260228",
       "input": [
           {
               "role": "user",
               "content": [
                   {
                       "type": "input_image",
                   "image_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png"
                   },
                   {
                       "type": "input_image",
                   "image_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/country_list.png"
                   },
                   {
                       "type": "input_text",
                   "text": "Based on the image, how many planets are listed in the table, and which row contains Earth? In the other image, how many countries are listed in the table?"
                   }
               ]
           }
       ]
     }'
   ```
   
   
   
   </Tab>
   <Tab zoneid="ogDbJhBZxe" title="Python">
   <TabTitle>Python</TabTitle>
   
   ```Python
   import os
   from byteplussdkarkruntime import Ark
   
   client = Ark(
       base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
       api_key=os.getenv('ARK_API_KEY')
   )
   
   response = client.responses.create(
       model="seed-2-0-lite-260228",
       input=[
           {
               "role": "user",
               "content": [
                   {
                       "type": "input_image",
                   "image_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png"
                   },
                   {
                       "type": "input_image",
                   "image_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/country_list.png"
                   },
                   {
                       "type": "input_text",
                   "text": "Based on the image, how many planets are listed in the table, and which row contains Earth? In the other image, how many countries are listed in the table?"
                   }
               ]
           }
       ]
   )
   
   print(response.output)
   ```
   
   
   
   </Tab>
   <Tab zoneid="b5Ap0IBqNB" title="Go">
   <TabTitle>Go</TabTitle>
   
   ```Go
   package main
   
   import (
       "context"
       "fmt"
       "os"
   
       "github.com/samber/lo"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/responses"
   )
   
   func main() {
       client := arkruntime.NewClientWithApiKey(
           os.Getenv("ARK_API_KEY"),
           arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
       )
       ctx := context.Background()
   
       inputMessage := &responses.ItemInputMessage{
           Role: responses.MessageRole_user,
           Content: []*responses.ContentItem{
               {
                   Union: &responses.ContentItem_Image{
                       Image: &responses.ContentItemImage{
                           Type:     responses.ContentItemType_input_image,
                       ImageUrl: lo.ToPtr("https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png"),
                       },
                   },
               },
               {
                   Union: &responses.ContentItem_Image{
                       Image: &responses.ContentItemImage{
                           Type:     responses.ContentItemType_input_image,
                       ImageUrl: lo.ToPtr("https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/country_list.png"),
                       },
                   },
               },
               {
                   Union: &responses.ContentItem_Text{
                       Text: &responses.ContentItemText{
                           Type: responses.ContentItemType_input_text,
                       Text: "Based on the image, how many planets are listed in the table, and which row contains Earth? In the other image, how many countries are listed in the table?",
                       },
                   },
               },
           },
       }
   
       resp, err := client.CreateResponses(ctx, &responses.ResponsesRequest{
           Model: "seed-2-0-lite-260228",
           Input: &responses.ResponsesInput{
               Union: &responses.ResponsesInput_ListValue{
                   ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{{
                       Union: &responses.InputItem_InputMessage{
                           InputMessage: inputMessage,
                       },
                   }}},
               },
           },
       })
       if err != nil {
           fmt.Printf("response error: %v\n", err)
           return
       }
       fmt.Println(resp)
   }
   ```
   
   
   
   </Tab>
   <Tab zoneid="kDZ2tryYq3" title="Java">
   <TabTitle>Java</TabTitle>
   
   ```Java
   package com.ark.sample;
   import com.byteplus.ark.runtime.model.responses.content.InputContentItemImage;
   import com.byteplus.ark.runtime.model.responses.content.InputContentItemText;
   import com.byteplus.ark.runtime.model.responses.item.ItemEasyMessage;
   import com.byteplus.ark.runtime.service.ArkService;
   import com.byteplus.ark.runtime.model.responses.request.*;
   import com.byteplus.ark.runtime.model.responses.response.ResponseObject;
   import com.byteplus.ark.runtime.model.responses.constant.ResponsesConstants;
   import com.byteplus.ark.runtime.model.responses.item.MessageContent;
   
   
   public class demo {
       public static void main(String[] args) {
           String apiKey = System.getenv("ARK_API_KEY");
           ArkService arkService = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();
   
           CreateResponsesRequest request = CreateResponsesRequest.builder()
                   .model("seed-2-0-lite-260228")
                   .input(ResponsesInput.builder().addListItem(
                           ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                   MessageContent.builder()
                                       .addListItem(InputContentItemImage.builder().imageUrl("https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png").build())
                                       .addListItem(InputContentItemImage.builder().imageUrl("https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/country_list.png").build())
                                       .addListItem(InputContentItemText.builder().text("Based on the image, how many planets are listed in the table, and which row contains Earth? In the other image, how many countries are listed in the table?").build())
                                           .build()
                           ).build()
                   ).build())
                   .build();
           ResponseObject resp = arkService.createResponse(request);
           System.out.println(resp);
   
           arkService.shutdownExecutor();
       }
   }
   ```
   
   
   
   </Tab>
   </Tabs>
   

* Chat API code samples:

   
   <Tabs>
   <Tab zoneid="pTff24cAEU" title="Curl">
   <TabTitle>Curl</TabTitle>
   
   ```Bash
   curl https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions \\
      -H "Content-Type: application/json"  \\
      -H "Authorization: Bearer $ARK_API_KEY"  \\
      -d '{
       "model": "seed-2-0-lite-260228",
       "messages": [
           {
               "role": "user",
               "content": [                
               {"type": "image_url","image_url": {"url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png"}},
               {"type": "image_url","image_url": {"url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/country_list.png"}},
               {"type": "text", "text": "Based on the image, how many planets are listed in the table, and which row contains Earth? In the other image, how many countries are listed in the table?"}
               ]
           }
       ],
       "max_tokens": 300
     }'
   ```
   
   
   
   </Tab>
   <Tab zoneid="jo3IMDmFiH" title="Python">
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
           {
               "role": "user",
               "content": [                
               {"type": "image_url","image_url": {"url":  "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png"}},
               {"type": "image_url","image_url": {"url":  "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/country_list.png"}},
               {"type": "text", "text": "Based on the image, how many planets are listed in the table, and which row contains Earth? In the other image, how many countries are listed in the table?"},
               ],
           }
       ],
   )
   
   print(completion.choices[0])
   ```
   
   
   
   </Tab>
   <Tab zoneid="DFC41IkuBw" title="Go">
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
           //Use os.Getenv to get ARK_API_KEY
           os.Getenv("ARK_API_KEY"),
           //The base URL for model invocation
           arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
       )
       // Create context background
       ctx := context.Background()
       // Construct message, including 2 images and a text
       contentParts := []*model.ChatCompletionMessageContentPart{
           // First image
           {
               Type: "image_url",
               ImageURL: &model.ChatMessageImageURL{
               URL: "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png",
               },
           },
           // Second image
           {
               Type: "image_url",
               ImageURL: &model.ChatMessageImageURL{
               URL: "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/country_list.png",
               },
           },
           // Text
           {
               Type: "text",
           Text: "Based on the image, how many planets are listed in the table, and which row contains Earth? In the other image, how many countries are listed in the table?",
           },
       }
       // Construct chat request
       req := model.CreateChatCompletionRequest{
           //Replace with Model ID
          Model: "seed-2-0-lite-260228",
          Messages: []*model.ChatCompletionMessage{
             {
                // Set message role as user
                Role: model.ChatMessageRoleUser,
                Content: &model.ChatCompletionMessageContent{
                   ListValue: contentParts, // Use ListValue for multi-type content
                },
             },
          },
          MaxTokens: byteplus.Int(300), // Set max output token count
       }
   
       // Send the chat completion request
       resp, err := client.CreateChatCompletion(ctx, req)
       if err!= nil {
          fmt.Printf("standard chat error: %v\\n", err)
          return
       }
       // Print response
       fmt.Println(*resp.Choices[0].Message.Content.StringValue)
   }
   ```
   
   
   
   </Tab>
   <Tab zoneid="HoafOEVSX6" title="Java">
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
     static ArkService service = ArkService.builder()
          .dispatcher(dispatcher)
          .connectionPool(connectionPool)
          .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3") //The base URL for model invocation
          .apiKey(apiKey)
          .build();
   
     public static void main(String[] args) throws Exception {
   
       List<ChatMessage> messagesForReqList = new ArrayList<>();
   
       // Construct content of the message
       List<ChatCompletionContentPart> contentParts = new ArrayList<>();
   
       // Use builder mode for the first image
       contentParts.add(ChatCompletionContentPart.builder()
            .type("image_url")
            .imageUrl(new ChatCompletionContentPartImageURL(
           "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png"))
            .build());
   
       //
       contentParts.add(ChatCompletionContentPart.builder()
            .type("image_url")
            .imageUrl(new ChatCompletionContentPartImageURL(
           "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/country_list.png"))
            .build());
   
       contentParts.add(ChatCompletionContentPart.builder()
            .type("text")
        .text("Based on the image, how many planets are listed in the table, and which row contains Earth? In the other image, how many countries are listed in the table?")
            .build());
   
       messagesForReqList.add(ChatMessage.builder()
            .role(ChatMessageRole.USER)
            .multiContent(contentParts)
            .build());
   
       ChatCompletionRequest req = ChatCompletionRequest.builder()
            .model("seed-2-0-lite-260228") //Replace with Model ID
            .messages(messagesForReqList)
            .maxTokens(300)
            .build();
   
       service.createChatCompletion(req)
            .getChoices()
            .forEach(choice -> System.out.println(choice.getMessage().getContent()));
       // Shutdown service after all requests are finished
       service.shutdownExecutor();
     }
   }
   ```
   
   
   
   </Tab>
   </Tabs>
   


<span id="bf4d9224"></span>
## Precision control of image understanding

Controlling the precision of image understanding (referring to the detail level of the image): The **image_pixel_limit** parameter and the **detail** parameter. If both are configured, the logic is as follows:


* Prerequisite: The image pixel range is [196, 36000000] px; otherwise, an exception will be thrown.

* Priority: **image_pixel_limit** has higher priority than **detail**. That is, when both **detail** and **image_pixel_limit** are configured, **image_pixel_limit** takes effect.

* Default behavior: If **min_pixels** / **max_pixels** of **image_pixel_limit** are not set, the corresponding values of **detail** are used. For specific ranges, see [Use the detail parameter (image understanding)](https://docs.byteplus.com/en/docs/ModelArk/1362931#885d96dc).


The following sections explain how to control the precision of visual understanding via **detail** and **image_pixel_limit**.

<span id="885d96dc"></span>
### Use the detail parameter (image understanding)

Control the precision of the model's image understanding via the `detail` parameter. The detail options, token ranges, and image pixel ranges supported by different models are as follows:

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">The default value of detail for the seed\-2\-0 model is <code>high</code>, with a fixed 1280 tokens per image, consuming fewer tokens without losing quality.</div>



<span aceTableMode="list" aceTableWidth="2,1,1,1,"></span>
|**Models** |**Detail options** |`low` |`high` |`xhigh` |
|---|---|---|---|---|
|Models prior to seed\-1\-8<br><br>> The default value for detail is `low` |Token range per image |[4, 1312] |[4, 5120] |N/A |
||Image pixel range |[3136, 1048576] |[3136, 4014080] |N/A |
|seed\-1\-8 model<br><br>> The default value for detail is `high` |Token range per image |[1, 1213] |[1, 5120] |N/A |
||Image pixel range |[1764, 2139732] |[1764, 9031680] |N/A |
|seed\-2\-0 model<br><br>> The default value for detail is `high` |Token range per image |[1, 1280] |1280 |[1280, 5120] |
||Image pixel range |[1764, 2257920] |2257920 |[2257920, 9031680] |



* When detail is `low`, the image processing speed increases. It is suitable for scenarios where the image itself has few details, or only the general information of the image needs to be understood by the model, or where speed is a requirement.

* When detail is `high` or `xhigh`, the model can perceive more details of the image, but the image processing speed decreases. It is suitable for scenarios where the image has a high pixel count (high resolution) and attention to detail is needed, such as street map analysis.


**Image scaling rule**: If the image pixel range does not fall within the range corresponding to the specified option, ModelArk will scale it proportionally to fit within the range.


* Responses API code samples:

   
   <Tabs>
   <Tab zoneid="IbssnRFUTH" title="Curl">
   <TabTitle>Curl</TabTitle>
   
   ```Bash
   curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
   -H "Authorization: Bearer $ARK_API_KEY" \\
   -H 'Content-Type: application/json' \\
   -d '{
       "model": "seed-2-0-lite-260228",
       "input": [
           {
               "role": "user",
               "content": [
                   {
                       "type": "input_image",
                   "image_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png",
                       "detail": "high"
                   },
                   {
                       "type": "input_text",
                       "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"
                   }
               ]
           }
       ]
   }'
   ```
   
   
   
   </Tab>
   <Tab zoneid="WQAXtTFZ6U" title="Python">
   <TabTitle>Python</TabTitle>
   
   ```Python
   import os
   from byteplussdkarkruntime import Ark
   
   client = Ark(
       base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
       api_key=os.getenv('ARK_API_KEY')
   )
   
   response = client.responses.create(
       model="seed-2-0-lite-260228",
       input=[
           {
               "role": "user",
               "content": [
                   {
                       "type": "input_image",
                   "image_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png",
                       "detail": "high"
                   },
                   {
                       "type": "input_text",
                       "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"
                   }
               ]
           }
       ]
   )
   
   print(response.output)
   ```
   
   
   
   </Tab>
   <Tab zoneid="q9X2l6l5Cf" title="Go">
   <TabTitle>Go</TabTitle>
   
   ```Go
   package main
   
   import (
       "context"
       "fmt"
       "os"
   
       "github.com/samber/lo"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/responses"
   )
   
   func main() {
       client := arkruntime.NewClientWithApiKey(
           os.Getenv("ARK_API_KEY"),
           arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
       )
       ctx := context.Background()
   
       inputMessage := &responses.ItemInputMessage{
           Role: responses.MessageRole_user,
           Content: []*responses.ContentItem{
               {
                   Union: &responses.ContentItem_Image{
                       Image: &responses.ContentItemImage{
                           Type:     responses.ContentItemType_input_image,
                       ImageUrl: lo.ToPtr("https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png"),
                           Detail:   lo.ToPtr(responses.ContentItemImageDetail_high),
                       },
                   },
               },
               {
                   Union: &responses.ContentItem_Text{
                       Text: &responses.ContentItemText{
                           Type: responses.ContentItemType_input_text,
                           Text: "Based on the image, how many planets are listed in the table, and which row contains Earth?",
                       },
                   },
               },
           },
       }
   
       resp, err := client.CreateResponses(ctx, &responses.ResponsesRequest{
           Model: "seed-2-0-lite-260228",
           Input: &responses.ResponsesInput{
               Union: &responses.ResponsesInput_ListValue{
                   ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{{
                       Union: &responses.InputItem_InputMessage{
                           InputMessage: inputMessage,
                       },
                   }}},
               },
           },
       })
       if err != nil {
           fmt.Printf("response error: %v\n", err)
           return
       }
       fmt.Println(resp)
   }
   ```
   
   
   
   </Tab>
   <Tab zoneid="lrRYSf0dJz" title="Java">
   <TabTitle>Java</TabTitle>
   
   ```Java
   package com.ark.sample;
   import com.byteplus.ark.runtime.model.responses.content.InputContentItemImage;
   import com.byteplus.ark.runtime.model.responses.content.InputContentItemText;
   import com.byteplus.ark.runtime.model.responses.item.ItemEasyMessage;
   import com.byteplus.ark.runtime.service.ArkService;
   import com.byteplus.ark.runtime.model.responses.request.*;
   import com.byteplus.ark.runtime.model.responses.response.ResponseObject;
   import com.byteplus.ark.runtime.model.responses.constant.ResponsesConstants;
   import com.byteplus.ark.runtime.model.responses.item.MessageContent;
   
   
   public class demo {
       public static void main(String[] args) {
           String apiKey = System.getenv("ARK_API_KEY");
           ArkService arkService = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();
   
           CreateResponsesRequest request = CreateResponsesRequest.builder()
                   .model("seed-2-0-lite-260228")
                   .input(ResponsesInput.builder().addListItem(
                           ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                   MessageContent.builder()
                                       .addListItem(InputContentItemImage.builder().imageUrl("https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png").detail("high").build())
                                           .addListItem(InputContentItemText.builder().text("Based on the image, how many planets are listed in the table, and which row contains Earth?").build())
                                           .build()
                           ).build()
                   ).build())
                   .build();
           ResponseObject resp = arkService.createResponse(request);
           System.out.println(resp);
   
           arkService.shutdownExecutor();
       }
   }
   ```
   
   
   
   </Tab>
   </Tabs>
   

* Chat API code samples:

   
   <Tabs>
   <Tab zoneid="tYt2MkHiI6" title="Curl">
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
               {"type": "image_url","image_url": {"url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png","detail": "high"}},
                   {"type": "text", "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"}
               ]
           }
       ]
     }'
   ```
   
   
   
   </Tab>
   <Tab zoneid="dRfnKSdw6o" title="Python">
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
           {
               "role": "user",
               "content": [                
               {"type": "image_url","image_url": {"url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png","detail": "high"}},
                   {"type": "text", "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"},
               ],
           }
       ],
   )
   
   print(completion.choices[0])
   ```
   
   
   
   </Tab>
   <Tab zoneid="Enzfpzh8oE" title="Go">
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
           //Use os.Getenv to get ARK_API_KEY
           os.Getenv("ARK_API_KEY"),
           //The base URL for model invocation
           arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
       )
       // Construct a context background
       ctx := context.Background()
       // Message content
       contentParts := []*model.ChatCompletionMessageContentPart{
           // Image
           {
               Type: "image_url",
               ImageURL: &model.ChatMessageImageURL{
               URL: "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png",
                   Detail: model.ImageURLDetailHigh,
               },
           },
           // Text
           {
               Type: "text",
               Text: "Based on the image, how many planets are listed in the table, and which row contains Earth?",
           },
       }
       req := model.CreateChatCompletionRequest{
           //Replace with Model ID
          Model: "seed-2-0-lite-260228",
          Messages: []*model.ChatCompletionMessage{
             {
                Role: model.ChatMessageRoleUser,
                Content: &model.ChatCompletionMessageContent{
                   ListValue: contentParts, // Use ListValue for multi-type content
                },
             },
          },
          MaxTokens: byteplus.Int(300), // Max output token
       }
   
       resp, err := client.CreateChatCompletion(ctx, req)
       if err!= nil {
          fmt.Printf("standard chat error: %v\\n", err)
          return
       }
       fmt.Println(*resp.Choices[0].Message.Content.StringValue)
   }
   ```
   
   
   
   </Tab>
   <Tab zoneid="IO0p8fwc7f" title="Java">
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
     static ArkService service = ArkService.builder()
          .dispatcher(dispatcher)
          .connectionPool(connectionPool)
          .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3")  //The base URL for model invocation  .
          .apiKey(apiKey)
          .build();
   
     public static void main(String[] args) throws Exception {
   
       List<ChatMessage> messagesForReqList = new ArrayList<>();
   
       List<ChatCompletionContentPart> contentParts = new ArrayList<>();
   
       contentParts.add(ChatCompletionContentPart.builder()
            .type("image_url")
            .imageUrl(new ChatCompletionContentPartImageURL(
           "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png","high"))
            .build());
   
       contentParts.add(ChatCompletionContentPart.builder()
            .type("text")
            .text("Based on the image, how many planets are listed in the table, and which row contains Earth?")
            .build());
   
       messagesForReqList.add(ChatMessage.builder()
            .role(ChatMessageRole.USER)
            .multiContent(contentParts)
            .build());
   
       ChatCompletionRequest req = ChatCompletionRequest.builder()
            .model("seed-2-0-lite-260228") //Replace with Model ID  .
            .messages(messagesForReqList)
            .maxTokens(300)
            .build();
   
       service.createChatCompletion(req)
            .getChoices()
            .forEach(choice -> System.out.println(choice.getMessage().getContent()));
       // Shutdown service after all requests are finished
       service.shutdownExecutor();
     }
   }
   ```
   
   
   
   </Tab>
   </Tabs>
   


<span id="d2b576dd"></span>
### Use the image_pixel_limit object

Control the pixel range of the image passed to ModelArk. If it is not within this range, it will be scaled proportionally up or down to fit within the range before being passed to the model for understanding. You can finely control the number of image pixels that the model can understand via the **image_pixel_limit** object.

The object is as follows:

```Bash
"image_pixel_limit": {
    "max_pixels": 3014080,   # Maximum image pixels
    "min_pixels": 3136       # Minimum image pixels
}
```


Code samples:

> The Java SDK and Go SDK do not support this object.


* Responses API code samples:

   
   <Tabs>
   <Tab zoneid="OXcWnfGmb7" title="Curl">
   <TabTitle>Curl</TabTitle>
   
   ```Bash
   curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
   -H "Authorization: Bearer $ARK_API_KEY" \\
   -H 'Content-Type: application/json' \\
   -d '{
       "model": "seed-2-0-lite-260228",
       "input": [
           {
               "role": "user",
               "content": [
                   {
                       "type": "input_image",
                   "image_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png",
                       "image_pixel_limit":  {
                           "max_pixels": 3014080,
                           "min_pixels": 3136
                        }
                   },
                   {
                       "type": "input_text",
                       "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"
                   }
               ]
           }
       ]
   }'
   ```
   
   
   
   </Tab>
   <Tab zoneid="MS4AJuwL6Q" title="Python">
   <TabTitle>Python</TabTitle>
   
   ```Python
   import os
   from byteplussdkarkruntime import Ark
   
   client = Ark(
       base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
       api_key=os.getenv('ARK_API_KEY')
   )
   
   response = client.responses.create(
       model="seed-2-0-lite-260228",
       input=[
           {
               "role": "user",
               "content": [
                   {
                       "type": "input_image",
                   "image_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png",
                       "image_pixel_limit": {
                           "max_pixels": 3014080,
                           "min_pixels": 3136,
                       }
                   },
                   {
                       "type": "input_text",
                       "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"
                   }
               ]
           }
       ]
   )
   
   print(response.output)
   ```
   
   
   
   </Tab>
   </Tabs>
   

* Chat API code samples:

   
   <Tabs>
   <Tab zoneid="Q8dtKdRa5z" title="Curl">
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
               {"type": "image_url","image_url": {"url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png","image_pixel_limit": {"max_pixels": 3014080,"min_pixels": 3136}}},
                   {"type": "text", "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"}
               ]
           }
       ],
       "max_tokens": 300
     }'
   ```
   
   
   
   </Tab>
   <Tab zoneid="MkJOI6yPwd" title="Python">
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
           {
               "role": "user",
               "content": [
                   {
                       "type": "image_url",
                       "image_url": {
                       "url":  "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png",
                           "image_pixel_limit": {
                               "max_pixels": 3014080,
                               "min_pixels": 3136,
                           },
                       },
                    },
                   {"type": "text", "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"},
               ],
           }
       ],
   )
   
   print(completion.choices[0])
   ```
   
   
   
   </Tab>
   </Tabs>
   


<span id="474e4601"></span>
## Mixed input of images and text

Supports passing prompts and images flexibly. You can pass images and text in `system message` or `user message`, and adjust the order arbitrarily. The model will return the processing results in order. Examples are as follows.

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">When images and text are mixed in the input, the order of images and text may affect the model's output. If the result is not as expected, you can adjust the order. When there are multiple images plus a piece of text, it is recommended to place the text after the images.</div>



* Responses API code samples:

   
   <Tabs>
   <Tab zoneid="oINORJIIEp" title="Curl">
   <TabTitle>Curl</TabTitle>
   
   ```Bash
   curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
   -H "Authorization: Bearer $ARK_API_KEY" \\
   -H 'Content-Type: application/json' \\
   -d '{
       "model": "seed-2-0-lite-260228",
       "input": [
           {
               "role": "system",
               "content": [
                   {
                       "type": "input_text",
                   "text": "The following person is the target person."
                   },
                   {
                       "type": "input_image",
                   "image_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/target.png"
                   },
                   {
                       "type": "input_text",
                   "text": "Please confirm whether the following images contain the target person."
                   }
               ]
           },
           {
               "role": "user",
               "content": [
                   {
                       "type": "input_text",
                   "text": "Does image 1 contain the target person?"
                   },
                   {
                       "type": "input_image",
                   "image_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/scene_01.png"
                   },
                   {
                       "type": "input_text",
                   "text": "Does image 2 contain the target person?"
                   },
                   {
                       "type": "input_image",
                   "image_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/scene_02.png"
                   }
               ]
           }
       ]
   }'
   ```
   
   
   
   </Tab>
   <Tab zoneid="Ix53cEN3zS" title="Python">
   <TabTitle>Python</TabTitle>
   
   ```Python
   import os
   from byteplussdkarkruntime import Ark
   
   client = Ark(
       base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
       api_key=os.getenv('ARK_API_KEY')
   )
   
   response = client.responses.create(
       model="seed-2-0-lite-260228",
       input=[
           {
               "role": "system",
               "content": [
                   {
                       "type": "input_text",
                   "text": "The following person is the target person."
                   },
                   {
                       "type": "input_image",
                   "image_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/target.png"
                   },
                   {
                       "type": "input_text",
                   "text": "Please confirm whether the following images contain the target person."
                   }
               ]
           },
           {
               "role": "user",
               "content": [
                   {
                       "type": "input_text",
                   "text": "Does image 1 contain the target person?"
                   },
                   {
                       "type": "input_image",
                   "image_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/scene_01.png"
                   },
                   {
                       "type": "input_text",
                   "text": "Does image 2 contain the target person?"
                   },
                   {
                       "type": "input_image",
                   "image_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/scene_02.png"
                   }
               ]
           }
       ]
   )
   
   print(response.output)
   ```
   
   
   
   </Tab>
   <Tab zoneid="ifvFMeuyaj" title="Go">
   <TabTitle>Go</TabTitle>
   
   ```Go
   package main
   
   import (
       "context"
       "fmt"
       "os"
   
       "github.com/samber/lo"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/responses"
   )
   
   func main() {
       client := arkruntime.NewClientWithApiKey(
           os.Getenv("ARK_API_KEY"),
           arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
       )
       ctx := context.Background()
   
       systemMessage := &responses.ItemInputMessage{
           Role: responses.MessageRole_system,
           Content: []*responses.ContentItem{
               {
                   Union: &responses.ContentItem_Text{
                       Text: &responses.ContentItemText{
                           Type: responses.ContentItemType_input_text,
                       Text: "The following person is the target person.",
                       },
                   },
               },
               {
                   Union: &responses.ContentItem_Image{
                       Image: &responses.ContentItemImage{
                           Type:     responses.ContentItemType_input_image,
                       ImageUrl: lo.ToPtr("https://ark-doc.tos-ap-southeast-1.bytepluses.com/target.png"),
                       },
                   },
               },
               {
                   Union: &responses.ContentItem_Text{
                       Text: &responses.ContentItemText{
                           Type: responses.ContentItemType_input_text,
                       Text: "Please confirm whether the following images contain the target person.",
                       },
                   },
               },
           },
       }
   
       userMessage := &responses.ItemInputMessage{
           Role: responses.MessageRole_user,
           Content: []*responses.ContentItem{
               {
                   Union: &responses.ContentItem_Text{
                       Text: &responses.ContentItemText{
                           Type: responses.ContentItemType_input_text,
                       Text: "Does image 1 contain the target person?",
                       },
                   },
               },
               {
                   Union: &responses.ContentItem_Image{
                       Image: &responses.ContentItemImage{
                           Type:     responses.ContentItemType_input_image,
                       ImageUrl: lo.ToPtr("https://ark-doc.tos-ap-southeast-1.bytepluses.com/scene_01.png"),
                       },
                   },
               },
               {
                   Union: &responses.ContentItem_Text{
                       Text: &responses.ContentItemText{
                           Type: responses.ContentItemType_input_text,
                       Text: "Does image 2 contain the target person?",
                       },
                   },
               },
               {
                   Union: &responses.ContentItem_Image{
                       Image: &responses.ContentItemImage{
                           Type:     responses.ContentItemType_input_image,
                       ImageUrl: lo.ToPtr("https://ark-doc.tos-ap-southeast-1.bytepluses.com/scene_02.png"),
                       },
                   },
               },
           },
       }
   
       resp, err := client.CreateResponses(ctx, &responses.ResponsesRequest{
           Model: "seed-2-0-lite-260228",
           Input: &responses.ResponsesInput{
               Union: &responses.ResponsesInput_ListValue{
                   ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{
                       {
                           Union: &responses.InputItem_InputMessage{
                               InputMessage: systemMessage,
                           },
                       },
                       {
                           Union: &responses.InputItem_InputMessage{
                               InputMessage: userMessage,
                           },
                       },
                   }},
               },
           },
       })
       if err != nil {
           fmt.Printf("response error: %v\n", err)
           return
       }
       fmt.Println(resp)
   }
   ```
   
   
   
   </Tab>
   <Tab zoneid="zYCWYwsMdH" title="Java">
   <TabTitle>Java</TabTitle>
   
   ```Java
   package com.ark.sample;
   import com.byteplus.ark.runtime.model.responses.content.InputContentItemImage;
   import com.byteplus.ark.runtime.model.responses.content.InputContentItemText;
   import com.byteplus.ark.runtime.model.responses.item.ItemEasyMessage;
   import com.byteplus.ark.runtime.service.ArkService;
   import com.byteplus.ark.runtime.model.responses.request.*;
   import com.byteplus.ark.runtime.model.responses.response.ResponseObject;
   import com.byteplus.ark.runtime.model.responses.constant.ResponsesConstants;
   import com.byteplus.ark.runtime.model.responses.item.MessageContent;
   
   
   public class demo {
       public static void main(String[] args) {
           String apiKey = System.getenv("ARK_API_KEY");
           ArkService arkService = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();
   
           CreateResponsesRequest request = CreateResponsesRequest.builder()
                   .model("seed-2-0-lite-260228")
                   .input(ResponsesInput.builder()
                           .addListItem(ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_SYSTEM).content(
                                   MessageContent.builder()
                                       .addListItem(InputContentItemText.builder().text("The following person is the target person.").build())
                                       .addListItem(InputContentItemImage.builder().imageUrl("https://ark-doc.tos-ap-southeast-1.bytepluses.com/target.png").build())
                                       .addListItem(InputContentItemText.builder().text("Please confirm whether the following images contain the target person.").build())
                                           .build()
                           ).build())
                           .addListItem(ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                   MessageContent.builder()
                                       .addListItem(InputContentItemText.builder().text("Does image 1 contain the target person?").build())
                                       .addListItem(InputContentItemImage.builder().imageUrl("https://ark-doc.tos-ap-southeast-1.bytepluses.com/scene_01.png").build())
                                       .addListItem(InputContentItemText.builder().text("Does image 2 contain the target person?").build())
                                       .addListItem(InputContentItemImage.builder().imageUrl("https://ark-doc.tos-ap-southeast-1.bytepluses.com/scene_02.png").build())
                                           .build()
                           ).build())
                           .build()
                   ).build();
   
           ResponseObject resp = arkService.createResponse(request);
           System.out.println(resp);
   
           arkService.shutdownExecutor();
       }
   }
   ```
   
   
   
   </Tab>
   </Tabs>
   

* Chat API code samples:

   
   <Tabs>
   <Tab zoneid="ATQq1jUszC" title="Curl">
   <TabTitle>Curl</TabTitle>
   
   ```Bash
   curl https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions \\
      -H "Content-Type: application/json" \\
      -H "Authorization: Bearer $ARK_API_KEY" \\
      -d '{
       "model": "seed-2-0-lite-260228",
       "messages": [
           {
               "role": "system",
               "content": [
               {"type": "text", "text": "The following person is the target person."},
                   {
                       "type": "image_url",
                       "image_url": {
                       "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/target.png"
                       }
                   },
               {"type": "text", "text": "Please confirm whether the following images contain the target person."}
               ]
           },
           {
               "role": "user",
               "content": [
               {"type": "text", "text": "Does image 1 contain the target person?"},
                   {
                       "type": "image_url",
                       "image_url": {
                       "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/scene_01.png"
                       }
                   },
               {"type": "text", "text": "Does image 2 contain the target person?"},
                   {
                       "type": "image_url",
                       "image_url": {
                       "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/scene_02.png"
                       }
                   }
               ]
           }
       ],
       "max_tokens": 300
     }'
   ```
   
   
   
   </Tab>
   <Tab zoneid="deUIOkG60M" title="Python">
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
           {
               "role": "system",
               "content": [
               {"type": "text", "text": "The following person is the target person."},
                   {
                       "type": "image_url",
                       "image_url": {
                       "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/target.png"
                       },
                   },
               {"type": "text", "text": "Please confirm whether the following images contain the target person."}
               ],
           },
           {
               "role": "user",
               "content": [
               {"type": "text", "text": "Does image 1 contain the target person?"},
                   {
                       "type": "image_url",
                       "image_url": {
                       "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/scene_01.png"
                       },
                   },
               {"type": "text", "text": "Does image 2 contain the target person?"},
                   {
                       "type": "image_url",
                       "image_url": {
                       "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/scene_02.png"
                       },
                   },
               ],
           },
       ],
   )
   
   
   print(completion.choices[0].message.content)
   ```
   
   
   
   </Tab>
   <Tab zoneid="urLSR2FoAO" title="Go">
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
       // Create a context, typically used to pass request context information, such as timeouts and cancellations
     ctx := context.Background()
   
     // Build the system message content
     systemContentParts := []*model.ChatCompletionMessageContentPart{
       // Text content
       {
         Type: "text",
     Text: "The following person is the target person.",
       },
       // Target person image
       {
         Type: "image_url",
         ImageURL: &model.ChatMessageImageURL{
       URL: "https://ark-doc.tos-ap-southeast-1.bytepluses.com/target.png",
         },
       },
       // Text content
       {
         Type: "text",
     Text: "Please confirm whether the following images contain the target person.",
       },
     }
   
     // Build the user message content
     userContentParts := []*model.ChatCompletionMessageContentPart{
       // Text
       {
         Type: "text",
     Text: "Does image 1 contain the target person?",
       },
       // First scene image
       {
         Type: "image_url",
         ImageURL: &model.ChatMessageImageURL{
       URL: "https://ark-doc.tos-ap-southeast-1.bytepluses.com/scene_01.png",
         },
       },
       // Text
       {
         Type: "text",
     Text: "Does image 2 contain the target person?",
       },
       // Second scene image
       {
         Type: "image_url",
         ImageURL: &model.ChatMessageImageURL{
       URL: "https://ark-doc.tos-ap-southeast-1.bytepluses.com/scene_02.png",
         },
       },
     }
   
     // Build a chat completion request and set the model and message content
     req := model.CreateChatCompletionRequest{
       //Replace with Model ID
       Model: "seed-2-0-lite-260228",
       Messages: []*model.ChatCompletionMessage{
         {
           // The message role is system
           Role: model.ChatMessageRoleSystem,
           Content: &model.ChatCompletionMessageContent{
             ListValue: systemContentParts,
           },
         },
         {
           // The message role is user
           Role: model.ChatMessageRoleUser,
           Content: &model.ChatCompletionMessageContent{
             ListValue: userContentParts,
           },
         },
       },
       MaxTokens: byteplus.Int(300),
     }
   
       // Send the chat completion request, store the result in resp, and store any possible errors in err
       resp, err := client.CreateChatCompletion(ctx, req)
       if err!= nil {
          fmt.Printf("standard chat error: %v\\n", err)
          return
       }
       fmt.Println(*resp.Choices[0].Message.Content.StringValue)
   }
   ```
   
   
   
   </Tab>
   <Tab zoneid="Olo1e1QN1x" title="Java">
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
     static ArkService service = ArkService.builder()
          .dispatcher(dispatcher)
          .connectionPool(connectionPool)
          .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3")  //The base URL for model invocation
          .apiKey(apiKey)
          .build();
   
     public static void main(String[] args) throws Exception {
       List<ChatMessage> messagesForReqList = new ArrayList<>();
       
       // Build the system message content
       List<ChatCompletionContentPart> systemContentParts = new ArrayList<>();
       systemContentParts.add(ChatCompletionContentPart.builder()
            .type("text")
        .text("The following person is the target person.")
            .build());
       systemContentParts.add(ChatCompletionContentPart.builder()
            .type("image_url")
            .imageUrl(new ChatCompletionContentPartImageURL(
           "https://ark-doc.tos-ap-southeast-1.bytepluses.com/target.png"))
            .build());
       systemContentParts.add(ChatCompletionContentPart.builder()
            .type("text")
        .text("Please confirm whether the following images contain the target person.")
            .build());
   
       // Create the system message
       messagesForReqList.add(ChatMessage.builder()
            .role(ChatMessageRole.SYSTEM)
            .multiContent(systemContentParts)
            .build());
   
       // Build the user message content
       List<ChatCompletionContentPart> userContentParts = new ArrayList<>();
       userContentParts.add(ChatCompletionContentPart.builder()
            .type("text")
        .text("Does image 1 contain the target person?")
            .build());
       userContentParts.add(ChatCompletionContentPart.builder()
            .type("image_url")
            .imageUrl(new ChatCompletionContentPartImageURL(
           "https://ark-doc.tos-ap-southeast-1.bytepluses.com/scene_01.png"))
            .build());
       userContentParts.add(ChatCompletionContentPart.builder()
            .type("text")
        .text("Does image 2 contain the target person?")
            .build());
       userContentParts.add(ChatCompletionContentPart.builder()
            .type("image_url")
            .imageUrl(new ChatCompletionContentPartImageURL(
           "https://ark-doc.tos-ap-southeast-1.bytepluses.com/scene_02.png"))
            .build());
   
       // Create user message
       messagesForReqList.add(ChatMessage.builder()
            .role(ChatMessageRole.USER)
            .multiContent(userContentParts)
            .build());
       ChatCompletionRequest req = ChatCompletionRequest.builder()
            .model("seed-2-0-lite-260228") //Replace with Model ID
            .messages(messagesForReqList)
            .maxTokens(300)
            .build();
   
       service.createChatCompletion(req)
            .getChoices()
            .forEach(choice -> System.out.println(choice.getMessage().getContent()));
       // shutdown service after all requests are finished
       service.shutdownExecutor();
     }
   }
   ```
   
   
   
   </Tab>
   </Tabs>
   


<span id="5fdeb294"></span>
## Visual grounding

Please refer to the tutorial [Visual grounding](https://docs.byteplus.com/en/docs/ModelArk/1616136).

<span id="7a123cd1"></span>
# Usage instructions

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">Processed images and videos will be deleted from the ModelArk server. ModelArk will not retain user data such as images, videos, and text information you submit for model training.</div>


<span id="f141b9ef"></span>
## About image pixels


1. The pixel ranges for images are as follows. An exception will be thrown if the limit is exceeded.

   * Width \> 14px and height \> 14px

   * Width\*height range: [196px, 36000000px]

   * Aspect ratio range: [1/150, 150]

2. Image preprocessing:

   According to the model used and the set detail option, the image is scaled proportionally to the corresponding range (see [Use the detail parameter (image understanding)](https://docs.byteplus.com/en/docs/ModelArk/1362931#885d96dc) for details), which can reduce model response latency and token consumption.


<span id="57188ace"></span>
## About image token usage

Token usage is calculated based on the width and height pixels of the image. The logic for estimating image token usage for different models is as follows. For the token range per image, see [Use the detail parameter (image understanding)](https://docs.byteplus.com/en/docs/ModelArk/1362931#885d96dc) .


<span aceTableMode="list" aceTableWidth="1,1"></span>
|Models prior to seed\-1\-8 |seed\-1\-8 model, seed\-2\-0 model |
|---|---|
|```JSON```<br>```min(image_width * image_height ÷ 784, max_image_tokens)```<br> |```JSON```<br>```min(image_width * image_height ÷ 1764, max_image_tokens)```<br> |


For example, if the maximum token per image passed to the model is 1312, the calculation of token consumption by the image is as follows:


* Image of `1280 px ×720 px`: The tokens consumed to understand this image are `1280×720÷784=1176`, which is less than 1312. According to the formula, the number of tokens consumed is 1176.

* Image of `1920 px ×1080 px`: The calculated value `1920×1080÷784=2645` is greater than 1312. According to the formula, the number of tokens consumed is 1312.

   In this case, the image will be compressed, meaning some details will be lost. For example, in images with very small text, the model may not be able to recognize the text.


<span id="4ecbf924"></span>
## About image quantity

The number of images passed in a single request is limited by the model's context window. When the input is too long to be held in the model's context window, the information will be truncated.

> For the model context window, see [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310). Examples:

> * When the total pixel value of images is large, the model context window used is 32k tokens, and each image is converted to 1312 tokens: The number of images that can be passed in a single request is `32000 ÷1312 =24`.

> * When the total pixel value of images is small, the model context window used is 32k tokens, and each image is converted to 256 tokens: The number of images that can be passed in a single request is `32000 ÷256 =125`.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">The quality of the model's response is affected by the amount of information in the input images. Too many images will lead to a decline in the quality of the model's response. Please pass a reasonable number of images in a single request.</div>


<span id="3d62f9e9"></span>
## About image size

When passing images via URL, a single image cannot exceed 10 MB.

When passing images via Base64 strings, a single image cannot exceed 10 MB, and the request body cannot exceed 64 MB.

When passing images via filepath, the image cannot exceed 512 MB.

<span id="51efc45f"></span>
## Supported image formats

The supported image formats are shown in the table below. Note that the file suffix must match the image format, which means that the image file extension (when passed via URL) and the image format declaration (when passed via Base64 encoding) must be consistent with the actual image information.


<span aceTableMode="list" aceTableWidth="1,1,1"></span>
|**Image format** |**File extension** |**Content type** |
|---|---|---|
|JPEG |.jpg or .jpeg |`image/jpeg` |
|PNG |.png |`image/png` |
|GIF |.gif |`image/gif` |
|WEBP |.webp |`image/webp` |
|BMP |.bmp |`image/bmp` |
|TIFF |.tiff or .tif |`image/tiff` |
|ICO |.ico |`image/ico` |
|DIB |.dib |`image/bmp` |
|ICNS |.icns |`image/icns` |
|SGI |.sgi |`image/sgi` |
|JPEG2000 |.j2c, .j2k, .jp2, .jpc, .jpf, or .jpx |`image/jp2` |
|HEIC |.heic |`image/heic` |
|HEIF |.heif |`image/heif` |


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>



* <div data-tips="true" data-tips-type="tip">Set when uploading files to object storage. For details, please refer to <a href="https://docs.byteplus.com/en/docs/tos/docs-managing-file-metadata">Documentation</a>.</div>


* <div data-tips="true" data-tips-type="tip">Use this when passing Base64 strings: <a href="https://docs.byteplus.com/en/docs/ModelArk/1362931#477e51ce">Pass Base64 string</a>.</div>


* <div data-tips="true" data-tips-type="tip">Image formats must be in lowercase.</div>


* <div data-tips="true" data-tips-type="tip">For image formats such as TIFF, SGI, ICNS, and JPEG2000, ensure that the image metadata matches the file metadata in TOS. Otherwise, parsing will fail. For details, see <a href="https://docs.byteplus.com/en/docs/ModelArk/1359411#2b362525">Error Invalid Parameter when using visual understanding model?</a>.</div>



<span id="c1f33d37"></span>
## About API parameters

The following parameters are not supported for visual understanding.


* Setting the frequency penalty coefficient is not supported; there is no **frequency_penalty** parameter.

* Setting the presence penalty coefficient is not supported; there is no **presence_penalty** parameter.

* Generating multiple responses for a single request is not supported; there is no **n** parameter.


<span id="b867b8aa"></span>
# FAQs


* [Error Invalid Parameter when using visual understanding model?](https://docs.byteplus.com/en/docs/ModelArk/1359411#2b362525)




