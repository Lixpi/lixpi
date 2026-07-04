Some models support processing PDF documents by using visual capabilities to understand the entire document's context. When a PDF document is provided, the model divides the file into pages, treating each page as an image. It then analyzes and interprets the corresponding text, images, and other content, using this information to perform document comprehension tasks.

<span id="5890f50b"></span>
# Prerequisites

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">If you're new to ModelArk, see <a href="https://docs.byteplus.com/en/docs/ModelArk/1399008">Quick start</a> to get up and running quickly.</div>


<span id="336a1278"></span>
# API interface

[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)

<span id="2f59d3af"></span>
# Document input methods

The following document input methods are supported:


* Local file upload:

   * Files API: Specify the local file path directly; the file size must not exceed 512 MB.

   * Base64 encoded string: Suitable for scenarios with smaller files; the file must be less than 50 MB, and the request body must not exceed 64 MB.

* File URL: Suitable for scenarios where the file already exists at a publicly accessible URL; the file size must not exceed 50 MB.


<span id="9086f24c"></span>
## Local file upload

<span id="d6d033c5"></span>
### Files API upload (recommended)

It is recommended to use the Files API to upload local files. This method supports processing files up to 512 MB, avoids re\-uploading content with each request, reduces latency caused by preprocessing, and allows the file to be reused across multiple requests, thereby reducing latency from public network downloads. For details on the principles of file preprocessing, see [Appendix: File preprocessing](https://docs.byteplus.com/en/docs/ModelArk/1902647#dbf9c161).


> * Files uploaded using this method are stored by default for 7 days, with a storage validity period ranging from 1 to 30 days.

> * To obtain analysis results in real time or to avoid client timeout failures caused by complex tasks, you can use stream output. For specific examples, see [Streaming output](https://docs.byteplus.com/en/docs/ModelArk/1902647#8e18e610).



<Tabs>
<Tab zoneid="ACGrPPRARR" title="Curl">
<TabTitle>Curl</TabTitle>

1. Upload PDF file to obtain File ID.

   ```Bash
   curl https://ark.ap-southeast.bytepluses.com/api/v3/files \\
   -H "Authorization: Bearer $ARK_API_KEY" \\
   -F 'purpose=user_data' \\
   -F 'file=@/Users/doc/demo.pdf'
   ```
   

2. Reference File ID in the Responses API.

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
                       "type": "input_file",
                       "file_id": "file-20251018****"
                   },
                   {
                       "type": "input_text",
                   "text": "Provide the document’s text content by paragraph and output it in JSON format, including the paragraph type (type) and text content (content)."
                   }
               ]
           }
       ]
   }'
   ```
   


</Tab>
<Tab zoneid="LNvSvrMzmI" title="Python">
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
    # upload pdf file
    print("Upload pdf file")
    file = await client.files.create(
        # replace with your local pdf path
        file=open("/Users/doc/demo.pdf", "rb"),
        purpose="user_data"
    )
    print(f"File uploaded: {file.id}")

    # Wait for the file to finish processing
    await client.files.wait_for_processing(file.id)
    print(f"File processed: {file.id}")

    response = await client.responses.create(
        model="seed-2-0-lite-260228",
        input=[
            {"role": "user", "content": [
                {
                    "type": "input_file",
                    "file_id": file.id  # ref pdf file id
                },
                {
                    "type": "input_text",
                    "text": "Provide the document’s text content by paragraph and output it in JSON format, including the paragraph type (type) and text content (content)."
                }
            ]},
        ],
    )
    print(response)

if __name__ == "__main__":
    asyncio.run(main())
```



</Tab>
<Tab zoneid="QiZbc4mRqq" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "io"
    "os"
    "time"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/file"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/responses"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    ctx := context.Background()

    fmt.Println("----- upload file data -----")
    data, err := os.Open("/Users/doc/demo.pdf")
    if err != nil {
        fmt.Printf("read file error: %v\\n", err)
        return
    }
    fileInfo, err := client.UploadFile(ctx, &file.UploadFileRequest{
        File:    data,
        Purpose: file.PurposeUserData,
    })

    if err != nil {
        fmt.Printf("upload file error: %v", err)
        return
    }

    // Wait for the file to finish processing
    for fileInfo.Status == file.StatusProcessing {
        fmt.Println("Waiting for file to be processed...")
        time.Sleep(2 * time.Second)
        fileInfo, err = client.RetrieveFile(ctx, fileInfo.ID) // update file info
        if err != nil {
            fmt.Printf("get file status error: %v", err)
            return
        }
    }
    fmt.Printf("File processing completed: %s, status: %s\\n", fileInfo.ID, fileInfo.Status)
    inputMessage := &responses.ItemInputMessage{
        Role: responses.MessageRole_user,
        Content: []*responses.ContentItem{
            {
                Union: &responses.ContentItem_File{
                    File: &responses.ContentItemFile{
                        Type:   responses.ContentItemType_input_file,
                        FileId: byteplus.String(fileInfo.ID),
                    },
                },
            },
            {
                Union: &responses.ContentItem_Text{
                    Text: &responses.ContentItemText{
                        Type: responses.ContentItemType_input_text,
                        Text: "Provide the document’s text content by paragraph and output it in JSON format, including the paragraph type (type) and text content (content).",
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
        Caching: &responses.ResponsesCaching{Type: responses.CacheType_enabled.Enum()},
    }

    resp, err := client.CreateResponses(ctx, createResponsesReq)
    if err != nil {
        fmt.Printf("stream error: %v\\n", err)
        return
    }
    fmt.Println(resp)
}
```



</Tab>
<Tab zoneid="Fi9Iy7h8CK" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.byteplus.ark.runtime.model.files.FileMeta;
import com.byteplus.ark.runtime.model.files.UploadFileRequest;
import com.byteplus.ark.runtime.model.responses.content.InputContentItemFile;
import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.model.responses.request.*;
import com.byteplus.ark.runtime.model.responses.item.ItemEasyMessage;
import com.byteplus.ark.runtime.model.responses.constant.ResponsesConstants;
import com.byteplus.ark.runtime.model.responses.item.MessageContent;
import com.byteplus.ark.runtime.model.responses.content.InputContentItemText;
import com.byteplus.ark.runtime.model.responses.response.ResponseObject;
import java.io.File;
import java.util.concurrent.TimeUnit;

public class demo {

    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        ArkService service = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

        System.out.println("===== Upload File Example=====");
        // upload a file for responses
        FileMeta fileMeta;
        fileMeta = service.uploadFile(
                UploadFileRequest.builder().
                        file(new File("/Users/doc/demo.pdf")) // replace with your file file path
                        .purpose("user_data")
                        .build());
        System.out.println("Uploaded file Meta: " + fileMeta);
        System.out.println("status:" + fileMeta.getStatus());

        try {
            while (fileMeta.getStatus().equals("processing")) {
                System.out.println("Waiting for file to be processed...");
                TimeUnit.SECONDS.sleep(2);
                fileMeta = service.retrieveFile(fileMeta.getId());
            }
        } catch (Exception e) {
            System.err.println("get file status error: " + e.getMessage());
        }
        System.out.println("Uploaded file Meta: " + fileMeta);

        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder()
                                        .addListItem(InputContentItemFile.InputContentItemFileBuilder.anInputContentItemFile().fileId(fileMeta.getId()).build())
                                        .addListItem(InputContentItemText.builder().text("Provide the document’s text content by paragraph and output it in JSON format, including the paragraph type (type) and text content (content).").build())
                                        .build()
                        ).build()
                ).build())
                .build();
        ResponseObject resp = service.createResponse(request);
        System.out.println(resp);
        service.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="fWTO4Y3Mq0" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
import os
import time
from openai import OpenAI

api_key = os.getenv('ARK_API_KEY')

client = OpenAI(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

file = client.files.create(
    file=open("/Users/doc/demo.pdf", "rb"),
    purpose="user_data"
)
# Wait for the file to finish processing
while (file.status == "processing"):
    time.sleep(2)
    file = client.files.retrieve(file.id)
print(f"File processed: {file}")
    
response = client.responses.create(
    model="seed-2-0-lite-260228",
    input=[
        {
            "role": "user",
            "content": [
                {
                    "type": "input_file",
                    "file_id": file.id,
                },
                {
                    "type": "input_text",
                     "text": "Provide the document’s text content by paragraph and output it in JSON format, including the paragraph type (type) and text content (content)."
                },
            ]
        }
    ]
)
print(response)
```



</Tab>
</Tabs>


Output example:

```JSON
{
    "text": [
        {
            "type": "heading",
            "content": "1 Introduction"
        },
        {
            "type": "paragraph",
            "content": "Diffusion models [3–5] learn to reverse a process that incrementally corrupts data with noise, effectively decomposing a complex distribution into a hierarchy of simplified representations. This coarse-to-fine generative approach has proven remarkably successful across a wide range of applications, including image and video synthesis [6] as well as solving complex challenges in natural sciences [7]."
        },
        ...
        {
            "type": "heading",
            "content": "3 Seed Diffusion"
        },
        {
            "type": "paragraph",
            "content": "As the first experimental model in our Seed Diffusion series, Seed Diffusion Preview is specifically focused on code generation, thus adopting the data pipeline (code/code-related data only) and processing methodology of the open-sourced Seed Coder project [20]. The architecture is a standard dense Transformer, and we intentionally omit complex components such as LongCoT reasoning in this initial version to first establish a strong and efficient performance baseline. This section introduces its key components and training strategies."
        }
    ]
}
```


<span id="8160343d"></span>
### Base64\-encoded string upload

Convert the local file into a Base64\-encoded string, then submit it to the large model. This method is suitable for documents with smaller file sizes; the file must not exceed 50 MB, and the request body must not exceed 64 MB.

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">Note</div>


<div data-tips="true" data-tips-type="warning">Convert the document to a Base64\-encoded string, then concatenate it following the <code>data:{mime_type};base64,{base64_data}</code> format and pass it to the model.</div>



* <div data-tips="true" data-tips-type="warning"><code>{mime_type}</code>: The media type of the file, which must correspond to the file format mime_type (<code>application/pdf</code>).</div>


* <div data-tips="true" data-tips-type="warning"><code>{base64_data}</code>: The string obtained after the file is encoded in Base64.</div>




<Tabs>
<Tab zoneid="gZCupvU5PN" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
BASE64_FILE=$(base64 < demo.pdf) && curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
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
            "type": "input_file",
            "file_data": "data:application/pdf;base64,$BASE64_FILE",
            "filename": "demo.pdf"
          },
          {
            "type": "input_text",
            "text": "Provide the document’s text content by paragraph and output it in JSON format, including the paragraph type (type) and text content (content)."
          }
        ]
      }
    ]
  }
EOF
```



</Tab>
<Tab zoneid="BNBrhD0eAa" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
from byteplussdkarkruntime import Ark
import base64

api_key = os.getenv('ARK_API_KEY')

client = Ark(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

# Convert local files to Base64-encoded strings.
def encode_file(file_path):
  with open(file_path, "rb") as read_file:
    return base64.b64encode(read_file.read()).decode('utf-8')
base64_file = encode_file("/Users/doc/demo.pdf")

response = client.responses.create(
    model="seed-2-0-lite-260228",
    input=[
        {
            "role": "user",
            "content": [
                {    
                    "type": "input_file",
                    "file_data": f"data:application/pdf;base64,{base64_file}",
                    "filename": "demo.pdf"
                },
                {
                    "type": "input_text",
                    "text": "Provide the document’s text content by paragraph and output it in JSON format, including the paragraph type (type) and text content (content)."
                }
            ]
        }
    ]
)

print(response)
```



</Tab>
<Tab zoneid="cu2zqfBoh3" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "encoding/base64"
    "fmt"
    "os"

    "github.com/samber/lo"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/responses"
)

func main() {
    // Convert local files to Base64-encoded strings.
    fileBytes, err := os.ReadFile("/Users/doc/demo.pdf")
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
                Union: &responses.ContentItem_File{
                    File: &responses.ContentItemFile{
                        Type:     responses.ContentItemType_input_file,
                        FileData: lo.ToPtr(fmt.Sprintf("data:application/pdf;base64,%s", base64File)),
                        Filename: lo.ToPtr("demo.pdf"),
                    },
                },
            },
            {
                Union: &responses.ContentItem_Text{
                    Text: &responses.ContentItemText{
                        Type: responses.ContentItemType_input_text,
                        Text: "Provide the document’s text content by paragraph and output it in JSON format, including the paragraph type (type) and text content (content).",  
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
        fmt.Printf("response error: %v", err)
        return
    }
    fmt.Println(resp)
}
```



</Tab>
<Tab zoneid="bGCSr19kfl" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;
import com.byteplus.ark.runtime.model.responses.content.InputContentItemFile;
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
            base64Data = "data:application/pdf;base64," + encodeFile("/Users/doc/demo.pdf");
        } catch (IOException e) {
            System.err.println("encode error: " + e.getMessage());
        }

        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder()
                                        .addListItem(InputContentItemFile.InputContentItemFileBuilder.anInputContentItemFile().fileData(base64Data).fileName("demo.pdf").build())
                                        .addListItem(InputContentItemText.builder().text("Provide the document’s text content by paragraph and output it in JSON format, including the paragraph type (type) and text content (content).").build())
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
<Tab zoneid="MUI9uPzYmg" title="OpenAI SDK">
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
base64_file = encode_file("/Users/doc/demo.pdf")

response = client.responses.create(
    model="seed-2-0-lite-260228",
    input=[
        {
            "role": "user",
            "content": [
                {    
                    "type": "input_file",
                    "file_data": f"data:application/pdf;base64,{base64_file}",
                    "filename": "demo.pdf"
                },
                {
                    "type": "input_text",
                    "text": "Provide the document’s text content by paragraph and output it in JSON format, including the paragraph type (type) and text content (content)."
                }
            ]
        }
    ]
)

print(response)
```



</Tab>
</Tabs>


<span id="69145d66"></span>
## File URL upload

If the document already exists at a publicly accessible URL, you can directly provide the document's public URL in the Responses API request; the file must not exceed 50 MB.


<Tabs>
<Tab zoneid="Jm2EgltWyP" title="Curl">
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
                    "type": "input_file",
                    "file_url": "<file URL>"
                },
                {
                    "type": "input_text",
                    "text": "Provide the document’s text content by paragraph and output it in JSON format, including the paragraph type (type) and text content (content)."
                }
            ]
        }
    ]
}'
```



</Tab>
<Tab zoneid="lUaMCiNrAJ" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
from byteplussdkarkruntime import Ark

api_key = os.getenv('ARK_API_KEY')

client = Ark(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

response = client.responses.create(
    model="seed-2-0-lite-260228",
    input=[
        {
            "role": "user",
            "content": [

                {
                    "type": "input_file",
                    "file_url": "<file URL>"
                },
                {
                    "type": "input_text",
                    "text": "Provide the document’s text content by paragraph and output it in JSON format, including the paragraph type (type) and text content (content)."
                },
            ],
        }
    ]
)

print(response)
```



</Tab>
<Tab zoneid="vrdcRwK1oA" title="Go">
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
                Union: &responses.ContentItem_File{
                    File: &responses.ContentItemFile{
                        Type:    responses.ContentItemType_input_file,
                        FileUrl: lo.ToPtr("<file URL>"),   
                    },
                },
            },
            {
                Union: &responses.ContentItem_Text{
                    Text: &responses.ContentItemText{
                        Type: responses.ContentItemType_input_text,
                        Text: "Provide the document’s text content by paragraph and output it in JSON format, including the paragraph type (type) and text content (content).",  
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
        fmt.Printf("response error: %v", err)
        return
    }
    fmt.Println(resp)
}
```



</Tab>
<Tab zoneid="NLs1lmTY9u" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.example;
import com.byteplus.ark.runtime.model.responses.content.InputContentItemFile;
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
        //The base URL for model invocation
        ArkService arkService = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder()
                                        .addListItem(InputContentItemFile.InputContentItemFileBuilder.anInputContentItemFile().fileUrl("<file URL>").build())
                                        .addListItem(InputContentItemText.builder().text("Provide the document’s text content by paragraph and output it in JSON format, including the paragraph type (type) and text content (content).").build())
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
<Tab zoneid="eSm0XaTZP1" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
import os
from openai import OpenAI

api_key = os.getenv('ARK_API_KEY')

client = OpenAI(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

response = client.responses.create(
    model="seed-2-0-lite-260228",
    input=[
        {
            "role": "user",
            "content": [

                {
                    "type": "input_file",
                    "file_url": "<file URL>"
                },
                {
                    "type": "input_text",
                    "text": "Provide the document’s text content by paragraph and output it in JSON format, including the paragraph type (type) and text content (content)."
                },
            ],
        }
    ]
)

print(response)
```



</Tab>
</Tabs>


<span id="8e18e610"></span>
# Streaming output

Streaming output enables real\-time, incremental rendering of results. It helps reduce perceived wait time and avoids client timeouts caused by long\-running inference in complex tasks, ensuring a smoother request workflow.


<Tabs>
<Tab zoneid="E4332xxE4l" title="Python">
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
    # upload pdf file
    print("Upload pdf file")
    file = await client.files.create(
        # replace with your local pdf path
        file=open("/Users/doc/demo.pdf", "rb"),
        purpose="user_data"
    )
    print(f"File uploaded: {file.id}")

    # Wait for the file to finish processing
    await client.files.wait_for_processing(file.id)
    print(f"File processed: {file.id}")

    stream = await client.responses.create(
        model="seed-2-0-lite-260228",
        input=[
            {"role": "user", "content": [
                {
                    "type": "input_file",
                    "file_id": file.id  # ref pdf file id
                },
                {
                    "type": "input_text",
                    "text": "Provide the document’s text content by paragraph and output it in JSON format, including the paragraph type (type) and text content (content)."
                }
            ]},
        ],
        caching={
            "type": "enabled",
        },
        store=True,
        stream=True
    )
    async for event in stream:
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

if __name__ == "__main__":
    asyncio.run(main())
```



</Tab>
<Tab zoneid="kAnhkyD9Lo" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "io"
    "os"
    "time"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/file"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/responses"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    ctx := context.Background()

    fmt.Println("----- upload file data -----")
    data, err := os.Open("/Users/doc/demo.pdf")
    if err != nil {
        fmt.Printf("read file error: %v\\n", err)
        return
    }
    fileInfo, err := client.UploadFile(ctx, &file.UploadFileRequest{
        File:    data,
        Purpose: file.PurposeUserData,
    })

    if err != nil {
        fmt.Printf("upload file error: %v", err)
        return
    }

    // Wait for the file to finish processing
    for fileInfo.Status == file.StatusProcessing {
        fmt.Println("Waiting for file to be processed...")
        time.Sleep(2 * time.Second)
        fileInfo, err = client.RetrieveFile(ctx, fileInfo.ID) // update file info
        if err != nil {
            fmt.Printf("get file status error: %v", err)
            return
        }
    }
    fmt.Printf("File processing completed: %s, status: %s\\n", fileInfo.ID, fileInfo.Status)
    inputMessage := &responses.ItemInputMessage{
        Role: responses.MessageRole_user,
        Content: []*responses.ContentItem{
            {
                Union: &responses.ContentItem_File{
                    File: &responses.ContentItemFile{
                        Type:   responses.ContentItemType_input_file,
                        FileId: byteplus.String(fileInfo.ID),
                    },
                },
            },
            {
                Union: &responses.ContentItem_Text{
                    Text: &responses.ContentItemText{
                        Type: responses.ContentItemType_input_text,
                        Text: "Provide the document’s text content by paragraph and output it in JSON format, including the paragraph type (type) and text content (content).",  
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
        Caching: &responses.ResponsesCaching{Type: responses.CacheType_enabled.Enum()},
    }

    resp, err := client.CreateResponsesStream(ctx, createResponsesReq)
    if err != nil {
        fmt.Printf("stream error: %v\\n", err)
        return
    }
    var responseId string
    for {
        event, err := resp.Recv()
        if err == io.EOF {
            break
        }
        if err != nil {
            fmt.Printf("stream error: %v\\n", err)
            return
        }
        handleEvent(event)
        if responseEvent := event.GetResponse(); responseEvent != nil {
            responseId = responseEvent.GetResponse().GetId()
            fmt.Printf("Response ID: %s", responseId)
        }
    }
}

func handleEvent(event *responses.Event) {
    switch event.GetEventType() {
    case responses.EventType_response_reasoning_summary_text_delta.String():
        print(event.GetReasoningText().GetDelta())
    case responses.EventType_response_reasoning_summary_text_done.String(): // aggregated reasoning text
        fmt.Printf("\\nAggregated reasoning text: %s\\n", event.GetReasoningText().GetText())
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
<Tab zoneid="a7OOE7SdDt" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.byteplus.ark.runtime.model.files.FileMeta;
import com.byteplus.ark.runtime.model.files.UploadFileRequest;
import com.byteplus.ark.runtime.model.responses.content.InputContentItemFile;
import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.model.responses.request.*;
import com.byteplus.ark.runtime.model.responses.item.ItemEasyMessage;
import com.byteplus.ark.runtime.model.responses.constant.ResponsesConstants;
import com.byteplus.ark.runtime.model.responses.item.MessageContent;
import com.byteplus.ark.runtime.model.responses.content.InputContentItemText;

import com.byteplus.ark.runtime.model.responses.event.functioncall.FunctionCallArgumentsDoneEvent;
import com.byteplus.ark.runtime.model.responses.event.outputitem.OutputItemAddedEvent;
import com.byteplus.ark.runtime.model.responses.event.outputitem.OutputItemDoneEvent;
import com.byteplus.ark.runtime.model.responses.event.outputtext.OutputTextDeltaEvent;
import com.byteplus.ark.runtime.model.responses.event.outputtext.OutputTextDoneEvent;
import com.byteplus.ark.runtime.model.responses.event.reasoningsummary.ReasoningSummaryTextDeltaEvent;
import com.byteplus.ark.runtime.model.responses.event.response.ResponseCompletedEvent;
import java.io.File;
import java.util.concurrent.TimeUnit;

public class demo {

    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        ArkService service = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

        System.out.println("===== Upload File Example=====");
        // upload a file for responses
        FileMeta fileMeta;
        fileMeta = service.uploadFile(
                UploadFileRequest.builder().
                        file(new File("/Users/doc/demo.pdf")) // replace with your file file path
                        .purpose("user_data")
                        .build());
        System.out.println("Uploaded file Meta: " + fileMeta);
        System.out.println("status:" + fileMeta.getStatus());

        try {
            while (fileMeta.getStatus().equals("processing")) {
                System.out.println("Waiting for file to be processed...");
                TimeUnit.SECONDS.sleep(2);
                fileMeta = service.retrieveFile(fileMeta.getId());
            }
        } catch (Exception e) {
            System.err.println("get file status error: " + e.getMessage());
        }
        System.out.println("Uploaded file Meta: " + fileMeta);

        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .stream(true)
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder()
                                        .addListItem(InputContentItemFile.InputContentItemFileBuilder.anInputContentItemFile().fileId(fileMeta.getId()).build())
                                        .addListItem(InputContentItemText.builder().text("Provide the document’s text content by paragraph and output it in JSON format, including the paragraph type (type) and text content (content).").build())
                                        .build()
                        ).build()
                ).build())
                .build();

        service.streamResponse(request)
                .doOnError(Throwable::printStackTrace)
                .blockingForEach(event -> {
                    if (event instanceof ReasoningSummaryTextDeltaEvent) {
                        System.out.print(((ReasoningSummaryTextDeltaEvent) event).getDelta());
                    }
                    if (event instanceof OutputItemAddedEvent) {
                        System.out.println("\\nOutputItem " + (((OutputItemAddedEvent) event).getItem().getType()) + " Start: ");
                    }
                    if (event instanceof OutputTextDeltaEvent) {
                        System.out.print(((OutputTextDeltaEvent) event).getDelta());
                    }
                    if (event instanceof OutputTextDoneEvent) {
                        System.out.println("\\nOutputText End.");
                    }
                    if (event instanceof OutputItemDoneEvent) {
                        System.out.println("\\nOutputItem " + ((OutputItemDoneEvent) event).getItem().getType() + " End.");
                    }
                    if (event instanceof FunctionCallArgumentsDoneEvent) {
                        System.out.println("\\nFunctionCall Arguments: " + ((FunctionCallArgumentsDoneEvent) event).getArguments());
                    }
                    if (event instanceof ResponseCompletedEvent) {
                        System.out.println("\\nResponse Completed. Usage = " + ((ResponseCompletedEvent) event).getResponse().getUsage());
                    }
                });


        service.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="S2Fd14M1PN" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
import os
import time
from openai import OpenAI

api_key = os.getenv('ARK_API_KEY')

client = OpenAI(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

file = client.files.create(
    file=open("/Users/doc/demo.pdf", "rb"),
    purpose="user_data"
)
# Wait for the file to finish processing
while (file.status == "processing"):
    time.sleep(2)
    file = client.files.retrieve(file.id)
print(f"File processed: {file}")
    
response = client.responses.create(
    model="seed-2-0-lite-260228",
    input=[
        {
            "role": "user",
            "content": [
                {
                    "type": "input_file",
                    "file_id": file.id,
                },
                {
                    "type": "input_text",
                    "text": "Provide the document’s text content by paragraph and output it in JSON format, including the paragraph type (type) and text content (content).",
                },
            ]
        }
    ],
    stream=True
)

for event in response:
    if event.type == "response.reasoning_summary_text.delta":
        print(event.delta, end="")
    if event.type == "response.output_item.added":
        print("\noutPutItem " + event.type + " start:")
    if event.type == "response.output_text.delta":
        print(event.delta,end="")
    if event.type == "response.output_item.done":
        print("\noutPutTextDone.")
    if event.type == "response.completed":
        print("\nResponse Completed. Usage = " + event.response.usage.model_dump_json())
```



</Tab>
</Tabs>


<span id="dbf9c161"></span>
# Appendix: File preprocessing

PDF files are processed page by page into multiple images. During preprocessing, the split images are not scaled in resolution to ensure that the images fully and clearly retain the original information from the PDF file.

When used as input, automatic scaling is performed according to the model's **input.content.detail** parameter `auto` behavior.



