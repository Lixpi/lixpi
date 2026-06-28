Vision language models can understand visual information in videos, and complete vision\-related tasks such as describing objects in the video and analyzing action logic. They can be used for automated video content review, intelligent monitoring analysis, etc., which greatly reduces labor costs, and are applicable to fields such as intelligent security, sports event analysis, and media content management. This tutorial helps you complete various tasks with video input through APIs.

<span id="31778cb5"></span>
# Supported models

See [Visual understanding](https://docs.byteplus.com/en/docs/ModelArk/1330310#ff5ef604).

<span id="f8d6cc48"></span>
# APIs


* [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request): Supports video input for analysis. Accepts File ID as an input for video understanding. For instructions, see [Upload via Files API (recommended)](https://docs.byteplus.com/en/docs/ModelArk/1895586#35d3ebc5).

* [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384): Supports video input for analysis.


<span id="547c81e8"></span>
# Video input methods

The supported video input methods are as follows:


* Upload local files:

   * [Upload via Files API (recommended)](https://docs.byteplus.com/en/docs/ModelArk/1895586#35d3ebc5): Upload local files directly. When files are stored in the TOS bucket of ModelArk, files up to 512 MB can be uploaded. When files are stored in your own TOS buckets, video files up to 2 GB can be uploaded to meet the needs for large files.

   * [Pass Base64 string](https://docs.byteplus.com/en/docs/ModelArk/1895586#22314028): Suitable for videos smaller than 50 MB, and the request body cannot exceed 64 MB.

* [Pass video URL](https://docs.byteplus.com/en/docs/ModelArk/1895586#8e3a48ed): Applicable to scenarios where the file already has a publicly accessible URL. The video file size cannot exceed 50 MB.


<span id="a8d59104"></span>
## Upload local files

<span id="35d3ebc5"></span>
### Upload via Files API (recommended)

We recommend using the Files API first to upload local files. When files are stored in the TOS bucket of ModelArk, files up to 512 MB can be uploaded. When files are stored in your own TOS buckets, video files up to 2 GB can be uploaded to meet the needs for large files. This also avoids repeatedly uploading content during requests, reduces preprocessing latency, and lets files be reused across multiple requests, saving public network download time. (Currently supported by Responses API)


> * Files uploaded in this way are stored for 7 days by default, and the storage validity period ranges from 1 to 30 days.

> * If you need to obtain analysis in real time or avoid client timeout failures caused by complex tasks, you can use the streaming output. For examples, see [Streaming output](https://docs.byteplus.com/en/docs/ModelArk/1895586#5cfd1f60).

* If the `tos` parameter is not passed, the file is stored in the TOS bucket of ModelArk by default. Code samples:



<Tabs>
<Tab zoneid="gsJqf6pZt4" title="cURL">
<TabTitle>cURL</TabTitle>

1. Upload a video file to obtain the File ID.

   ```Bash
   curl https://ark.ap-southeast.bytepluses.com/api/v3/files \
   -H "Authorization: Bearer $ARK_API_KEY" \
   -F 'purpose=user_data' \
   -F 'file=@/Users/doc/demo.mp4' \
   -F 'preprocess_configs[video][fps]=0.3'
   ```
   

2. Reference the File ID in the Responses API.

   ```Bash
   curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \
   -H "Authorization: Bearer $ARK_API_KEY" \
   -H 'Content-Type: application/json' \
   -d '{
       "model": "seed-2-0-lite-260228",
       "input": [
           {
               "role": "user",
               "content": [
                   {
                       "type": "input_video",
                       "file_id": "file-20251018****"
                   },
                   {
                       "type": "input_text",
                       "text": "Please describe the movement sequence of the characters in the video, and output the start time (start_time), end time (end_time), event (event), and danger status (danger) in JSON format. Please use HH:mm:ss to represent the timestamp."
                   }
               ]
           }
       ]
   }'
   ```
   


</Tab>
<Tab zoneid="KF1UCbTz8z" title="Python">
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
    # upload video file
    print("Upload video file")
    file = await client.files.create(
        # replace with your local video path
        file=open("/Users/doc/demo.mp4", "rb"),
        purpose="user_data",
        preprocess_configs={
            "video": {
                "fps": 0.3,  # define the sampling fps of the video, default is 1.0
            }
        }
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
                    "type": "input_video",
                    "file_id": file.id  # ref video file id
                },
                {
                    "type": "input_text",
                        "text": "Please describe the movement sequence of the characters in the video, and output the start time (start_time), end time (end_time), event (event), and danger status (danger) in JSON format. Please use HH:mm:ss to represent the timestamp."

                }
            ]},
        ]
    )
    print(response)

if __name__ == "__main__":
    asyncio.run(main())
```



</Tab>
<Tab zoneid="L80qEQOYgi" title="Go">
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
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/volcengine"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        // Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
        os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    ctx := context.Background()

    fmt.Println("----- upload video data -----")
    data, err := os.Open("/Users/doc/demo.mp4")
    if err != nil {
        fmt.Printf("read file error: %v\n", err)
        return
    }
    fileInfo, err := client.UploadFile(ctx, &file.UploadFileRequest{
        File:    data,
        Purpose: file.PurposeUserData,
        PreprocessConfigs: &file.PreprocessConfigs{
            Video: &file.Video{
                Fps: volcengine.Float64(0.3),
            },
        },
    })

    if err != nil {
        fmt.Printf("upload file error: %v", err)
        return
    }

    // Wait for the file to finish processing
    for fileInfo.Status == file.StatusProcessing {
        fmt.Println("Waiting for video to be processed...")
        time.Sleep(2 * time.Second)
        fileInfo, err = client.RetrieveFile(ctx, fileInfo.ID) // update file info
        if err != nil {
            fmt.Printf("get file status error: %v", err)
            return
        }
    }
    fmt.Printf("Video processing completed: %s, status: %s\n", fileInfo.ID, fileInfo.Status)
    inputMessage := &responses.ItemInputMessage{
        Role: responses.MessageRole_user,
        Content: []*responses.ContentItem{
            {
                Union: &responses.ContentItem_Video{
                    Video: &responses.ContentItemVideo{
                        Type:   responses.ContentItemType_input_video,
                        FileId: volcengine.String(fileInfo.ID),
                    },
                },
            },
            {
                Union: &responses.ContentItem_Text{
                    Text: &responses.ContentItemText{
                        Type: responses.ContentItemType_input_text,
                        Text: "Please describe the movement sequence of the characters in the video, and output the start time (start_time), end time (end_time), event (event), and danger status (danger) in JSON format. Please use HH:mm:ss to represent the timestamp.",
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
        fmt.Printf("stream error: %v\n", err)
        return
    }
    fmt.Println(resp)
}
```



</Tab>
<Tab zoneid="sieYpPA7oX" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.byteplus.ark.runtime.model.files.FileMeta;
import com.byteplus.ark.runtime.model.files.PreprocessConfigs;
import com.byteplus.ark.runtime.model.files.UploadFileRequest;
import com.byteplus.ark.runtime.model.files.Video;
import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.model.responses.request.*;
import com.byteplus.ark.runtime.model.responses.item.ItemEasyMessage;
import com.byteplus.ark.runtime.model.responses.constant.ResponsesConstants;
import com.byteplus.ark.runtime.model.responses.item.MessageContent;
import com.byteplus.ark.runtime.model.responses.content.InputContentItemVideo;
import com.byteplus.ark.runtime.model.responses.content.InputContentItemText;
import com.byteplus.ark.runtime.model.responses.response.ResponseObject;
import java.io.File;
import java.util.concurrent.TimeUnit;

public class demo {
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        ArkService service = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

        System.out.println("===== Upload File Example=====");
        // upload a video for responses
        FileMeta fileMeta;
        fileMeta = service.uploadFile(
                UploadFileRequest.builder().
                        file(new File("/Users/doc/demo.mp4")) // replace with your image file path
                        .purpose("user_data")
                        .preprocessConfigs(PreprocessConfigs.builder().video(new Video(0.3)).build())
                        .build());
        System.out.println("Uploaded file Meta: " + fileMeta);
        System.out.println("status:" + fileMeta.getStatus());

        try {
            while (fileMeta.getStatus().equals("processing")) {
                System.out.println("Waiting for video to be processed...");
                TimeUnit.SECONDS.sleep(2);
                fileMeta = service.retrieveFile(fileMeta.getId());
            }
        } catch (Exception e) {
>             System.err.println("get file status error: " + e.getMessage());
        }
        System.out.println("Uploaded file Meta: " + fileMeta);

        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder()
                                        .addListItem(InputContentItemVideo.builder().fileId(fileMeta.getId()).build())
                                        .addListItem(InputContentItemText.builder().text("Please describe the movement sequence of the characters in the video, and output the start time (start_time), end time (end_time), event (event), and danger status (danger) in JSON format. Please use HH:mm:ss to represent the timestamp.").build())
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
<Tab zoneid="N1pLcDScKM" title="OpenAI SDK">
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
    file=open("/Users/doc/demo.mp4", "rb"),
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
                    "type": "input_video",
                    "file_id": file.id,
                },
                {
                    "type": "input_text",
                     "text": "Please describe the movement sequence of the characters in the video, and output the start time (start_time), end time (end_time), event (event), and danger status (danger) in JSON format. Please use HH:mm:ss to represent the timestamp.",
                },
            ]
        }
    ]
)
print(response)
```



</Tab>
</Tabs>



* If the `tos` parameter is passed, the file is stored in your own TOS bucket. Video files up to 2 GB can be uploaded. Code samples:


```bash
curl -X POST "https://ark.ap-southeast.bytepluses.com/api/v3/files" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -F "purpose=user_data" \
  -F "url=tos://my-bucket/videos/long-video.mp4" \
  -F "tos[bucket]=my-bucket" \
  -F "tos[prefix]=ark-files/" \
  -F "preprocess_configs[video][max_video_tokens]=200000" \
  -F "preprocess_configs[video][min_frames]=16"
```


<span id="22314028"></span>
### Pass Base64 string

Convert the local file to a Base64 encoded string and submit it to the large model. This method is suitable for videos smaller than 50 MB, and the request body cannot exceed 64 MB. (Supported by both Responses API and Chat API.)

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">warning</div>


<div data-tips="true" data-tips-type="warning">Convert the video file to a Base64 encoded string, concatenate it in the format <code>data:{mime_type};base64,{base64_data}</code>, and pass it to the model.</div>



* <div data-tips="true" data-tips-type="warning"><code>{mime_type}</code>: The media type of the file, which must be identical with the file's mime_type. For details about supported video formats, see <a href="https://docs.byteplus.com/en/docs/ModelArk/1895586#1d125314">Supported video formats</a>.</div>


* <div data-tips="true" data-tips-type="warning"><code>{base64_data}</code>: The Base64 encoded string of the file.</div>


* Responses API code samples:



<Tabs>
<Tab zoneid="sMCVOBt7G1" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
BASE64_FILE=$(base64 < demo.mp4) && curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \
   -H "Content-Type: application/json"  \
   -H "Authorization: Bearer $ARK_API_KEY"  \
   -d @- <<EOF
   {
    "model": "seed-2-0-lite-260228",
    "input": [
      {
        "role": "user",
        "content": [
          {
            "type": "input_video",
            "video_url": "data:video/mp4;base64,$BASE64_FILE",
            "fps": 1
          }
        ]
      }
    ]
  }
EOF
```



</Tab>
<Tab zoneid="fusbXC9d34" title="Python">
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
base64_file = encode_file("/Users/doc/demo.mp4")

response = client.responses.create(
    model="seed-2-0-lite-260228",
    input=[
        {
            "role": "user",
            "content": [
                {    
                    "type": "input_video",
                    "video_url": f"data:video/mp4;base64,{base64_file}",
                    "fps":1
                }
            ],
        }
    ]
)

print(response)
```



</Tab>
<Tab zoneid="sJVGa4QCZz" title="Go">
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
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/volcengine"
)

func main() {
    // Convert local files to Base64-encoded strings.
    fileBytes, err := os.ReadFile("/Users/doc/demo.mp4") 
    if err != nil {
        fmt.Printf("read file error: %v\n", err)
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
                Union: &responses.ContentItem_Video{
                    Video: &responses.ContentItemVideo{
                        Type:     responses.ContentItemType_input_video,
                        VideoUrl: fmt.Sprintf("data:video/mp4;base64,%s", base64File),
                        Fps:      volcengine.Float32(1),
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
<Tab zoneid="MFtpCJE2jC" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;
import com.byteplus.ark.runtime.model.responses.content.InputContentItemImage;
import com.byteplus.ark.runtime.model.responses.content.InputContentItemText;
import com.byteplus.ark.runtime.model.responses.content.InputContentItemVideo;
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
            base64Data = "data:video/mp4;base64," + encodeFile("/Users/demo.mp4");
        } catch (IOException e) {
             System.err.println("Encoding failed: " + e.getMessage());
        }
        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder()
                                        .addListItem(InputContentItemVideo.builder().videoUrl(base64Data).fps(2F).build())
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
<Tab zoneid="k1AwQkzZJF" title="OpenAI SDK">
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
base64_file = encode_file("/Users/doc/demo.mp4")

response = client.responses.create(
    model="seed-2-0-lite-260228",
    input=[
        {
            "role": "user",
            "content": [
                {    
                    "type": "input_video",
                    "video_url": f"data:video/mp4;base64,{base64_file}",
                    "fps":1
                }
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
<Tab zoneid="waCmmapguG" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
BASE64_VIDEO=$(base64 < demo.mp4) && curl https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions \
   -H "Content-Type: application/json"  \
   -H "Authorization: Bearer $ARK_API_KEY"  \
   -d @- <<EOF
   {
    "model": "seed-2-0-lite-260228",
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "video_url",
            "video_url": {
              "url": "data:video/mp4;base64,$BASE64_VIDEO"
            }
          },
          {
            "type": "text",
            "text": "What is in the video?"
          }
        ]
      }
    ],
    "max_tokens": 300
  }
EOF
```



* Replace the Model ID as needed. To query the Model ID, see [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310).


</Tab>
<Tab zoneid="T7dFajFCbL" title="Python">
<TabTitle>Python</TabTitle>

```Python
import base64
import os
# Install SDK:  pip install byteplus-python-sdk-v2 .
from byteplussdkarkruntime import Ark 

client = Ark(
    # The base URL for model invocation .
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
)

 Define a method to convert the video at the specified path to Base64 string
def encode_video(video_path):
  with open(video_path, "rb") as video_file:
    return base64.b64encode(video_file.read()).decode('utf-8')

# Video to be passed to the large model
video_path = "demo.mp4"

# Convert the video to Base64 string
base64_video = encode_video(video_path)

completion = client.chat.completions.create(
  # Replace with Model ID .
  model = "seed-2-0-lite-260228",
  messages=[
    {
      "role": "user",
      "content": [
        {
          "type": "video_url",
          "video_url": {
            "url":  f"data:video/<VIDEO_FORMAT>;base64,{base64_video}"
          },         
        },
        {
          "type": "text",
          "text": "What's in the video?",
        },
      ],
    }
  ],
)

print(completion.choices[0])
```



</Tab>
<Tab zoneid="bsaY94uRdR" title="Go">
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
    // Read local video file
    videoBytes, err := os.ReadFile("demo.mp4") // Replace with actual video path
    if err != nil {
        fmt.Printf("Failed to read video: %v\n", err)
        return
    }
    base64Video := base64.StdEncoding.EncodeToString(videoBytes)

    client := arkruntime.NewClientWithApiKey(
        // Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
        os.Getenv("ARK_API_KEY"),
        // The base URL for model invocation .
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
        )
    ctx := context.Background()
    req := model.CreateChatCompletionRequest{
        // Replace with Model ID
        Model: "seed-2-0-lite-260228",
        Messages: []*model.ChatCompletionMessage{
            {
                Role: "user",
                Content: &model.ChatCompletionMessageContent{
                    ListValue: []*model.ChatCompletionMessageContentPart{
                        {
                            Type: "video_url",
                            VideoURL: &model.ChatMessageVideoURL{
                                URL: fmt.Sprintf("data:video/mp4;base64,%s", base64Video),
                            },
                        },
                        {
                            Type: "text",
                            Text: "What's in the video?",
                        },
                    },
                },
            },
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
<Tab zoneid="mdr6pf4s8Q" title="Java">
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
        .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3") // The base URL for model invocation
        .apiKey(apiKey) //Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
        .build();

    // Base64 encoding method
    private static String encodeVideo(String videoPath) throws IOException {
        byte[] videoBytes = Files.readAllBytes(Path.of(videoPath));
        return Base64.getEncoder().encodeToString(videoBytes);
    }

    public static void main(String[] args) throws Exception {

        List<ChatMessage> messagesForReqList = new ArrayList<>();

// Local video path (replace with actual path)
        String videoPath = "demo.mp4";

// Generate Base64 URL
        String base64Data = "data:video/mp4;base64," + encodeVideo(videoPath);

// Construct message content (fixed the construction method of the content part)
        List<ChatCompletionContentPart> contentParts = new ArrayList<>();

// Use builder pattern for the video part
        contentParts.add(ChatCompletionContentPart.builder()
                .type("video_url")
                .videoUrl(new ChatCompletionContentPartVideoURL(base64Data, 2))
                .build());

// Use builder pattern for the text part
        contentParts.add(ChatCompletionContentPart.builder()
                .type("text")
                .text("What's in the video?")
                .build());

// Create message
        messagesForReqList.add(ChatMessage.builder()
                .role(ChatMessageRole.USER)
                .multiContent(contentParts)
                .build());

        ChatCompletionRequest req = ChatCompletionRequest.builder()
                .model("seed-2-0-lite-260228") //Replace with Model ID .
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


<span id="8e3a48ed"></span>
## Pass video URL

If the video already has a publicly accessible URL, you can directly fill in the public URL of the video in the request. A single video cannot exceed 50 MB. (Supported by both Responses API and Chat API.)


* Responses API code samples:



<Tabs>
<Tab zoneid="iHaKsIFKpZ" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \
-H "Authorization: Bearer $ARK_API_KEY" \
-H 'Content-Type: application/json' \
-d '{
    "model": "seed-2-0-lite-260228",
    "input": [
        {
            "role": "user",
            "content": [
                {    
                    "type": "input_video",
                    "video_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_video/ark_vlm_video_input.mp4",
                    "fps":1
                }
            ]
        }
    ]
}'
```



</Tab>
<Tab zoneid="L14wtF3TPv" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
from byteplussdkarkruntime import Ark

# Get your API key from environment variables. See configuration method at: https://docs.byteplus.com/en/docs/ModelArk/1399008
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
                    "type": "input_video",
                    "video_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_video/ark_vlm_video_input.mp4",
                    "fps":1
                }
            ],
        }
    ]
)

print(response)
```



</Tab>
<Tab zoneid="EjEs4ez4d6" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/responses"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/volcengine"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        //Get ARK_API_KEY from environment variables via os.Getenv
        os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    // Create a context, which is usually used to pass request context information such as timeout, cancellation, etc.
    ctx := context.Background()

    inputMessage := &responses.ItemInputMessage{
        Role: responses.MessageRole_user,
        Content: []*responses.ContentItem{
            {
                Union: &responses.ContentItem_Video{
                    Video: &responses.ContentItemVideo{
                        Type:     responses.ContentItemType_input_video,
                        VideoUrl: "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_video/ark_vlm_video_input.mp4",
                        Fps:      volcengine.Float32(1),
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
<Tab zoneid="NoDftdAB5e" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.example;
import com.byteplus.ark.runtime.model.responses.content.InputContentItemImage;
import com.byteplus.ark.runtime.model.responses.content.InputContentItemText;
import com.byteplus.ark.runtime.model.responses.content.InputContentItemVideo;
import com.byteplus.ark.runtime.model.responses.item.ItemEasyMessage;
import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.model.responses.request.*;
import com.byteplus.ark.runtime.model.responses.response.ResponseObject;
import com.byteplus.ark.runtime.model.responses.constant.ResponsesConstants;
import com.byteplus.ark.runtime.model.responses.item.MessageContent;


public class demo {
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        // Create an ArkService instance
        ArkService arkService = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder()
                                        .addListItem(InputContentItemVideo.builder().videoUrl("https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_video/ark_vlm_video_input.mp4").fps(2F).build())
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
<Tab zoneid="WC1HNdpzq4" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
import os
from openai import OpenAI

# Get your API key from environment variables. See configuration method at: https://docs.byteplus.com/en/docs/ModelArk/1399008
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
                    "type": "input_video",
                    "video_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_video/ark_vlm_video_input.mp4",
                    "fps":1
                }
            ],
        }
    ]
)

print(response)
```



</Tab>
</Tabs>



* The Chat API code samples are as follows: (see [Precision control of video understanding](https://docs.byteplus.com/en/docs/ModelArk/1895586#bf4d9224))



<Tabs>
<Tab zoneid="C1W6wvrt4C" title="Python SDK">
<TabTitle>Python SDK</TabTitle>

```Python
import os
# Install SDK:  pip install byteplus-python-sdk-v2
from byteplussdkarkruntime import Ark 

client = Ark(
    # The base URL for model invocation
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
)

completion = client.chat.completions.create(
    # Replace with Model ID .
    model = "seed-2-0-lite-260228",
    messages = [
        {
            "role": "user",  
            "content": [   
                {
                    "type": "video_url",
                    "video_url": {
                        # Replace the link with your actual video link
                        "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/video_understanding.mp4",
                        "fps": 1
                    }
                },
            ],
        }
    ],
)

print(completion.choices[0].message.content)
```



</Tab>
</Tabs>


<span id="fbc687c2"></span>
# Use cases

<span id="bf4d9224"></span>
## Precision control of video understanding

You can use the **fps** parameter to control the frequency of sampling images from the video. The default value is 1, which means one frame is sampled from the video per second and input to the model for visual understanding. You can also use the **fps** parameter to control the model's sensitivity to image changes in the video.


* When the video frames change drastically or you need to focus on picture changes, such as counting the number of character movements in the video, you can turn up the **fps** setting (maximum `5`) to avoid misjudgment caused by low frame sampling frequency.

* When the video frames do not change frequently or you do not need to focus on picture changes, such as counting the number of people in the picture, you can turn down the **fps** (minimum `0.2`), which can improve processing speed and save token usage.


Code samples:


<Tabs>
<Tab zoneid="cVNsxqEnpB" title="Curl">
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
                {"type": "video_url","video_url": {"url":  "https://ark-doc.tos-ap-southeast-1.bytepluses.com/video_understanding.mp4", "fps": 2}},
                {"type": "text", "text": "What is in the video?"}
            ]
        }
    ],
    "max_tokens": 300
  }'
```



* Replace the Model ID as needed. To query the Model ID, see [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310).


</Tab>
<Tab zoneid="MtDNyolA53" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
# Install SDK:  pip install byteplus-python-sdk-v2 .
from byteplussdkarkruntime import Ark 

client = Ark(
    # The base URL for model invocation .
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
)

completion = client.chat.completions.create(
    # Replace with Model ID .
    model = "seed-2-0-lite-260228",
    messages=[
        {
            # The message role is user
            "role": "user",
            "content": [
                {
                    "type": "video_url",
                    "video_url": {
                        # Replace the link with your actual video link
                        "url":  "https://ark-doc.tos-ap-southeast-1.bytepluses.com/video_understanding.mp4",
                        "fps": 2, # Capture 2 frames per second for video understanding
                    }
                },
                # Message of text type, asking what is in the video
                {"type": "text", "text": "What's in the video?"},
            ],
        }
    ],
)

print(completion.choices[0])
```



</Tab>
<Tab zoneid="oAYscitVOu" title="Go">
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
        // Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
        os.Getenv("ARK_API_KEY"),
        // The base URL for model invocation .
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    // Create a context, which is usually used to pass request context information such as timeout, cancellation, etc.
    ctx := context.Background()
    // Build the message content
    contentParts := []*model.ChatCompletionMessageContentPart{
        {
            Type: "video_url",
            VideoURL: &model.ChatMessageVideoURL{
                URL: "https://ark-doc.tos-ap-southeast-1.bytepluses.com/video_understanding.mp4",
                FPS: byteplus.Float64(2),
            },
        },
        // Text content
        {
            Type: "text",
            Text: "What's in the video?",
        },
    }
    // Construct a chat completion request, and set the model and message content for the request
    req := model.CreateChatCompletionRequest{
        // Replace with Model ID
       Model: "seed-2-0-lite-260228",
       Messages: []*model.ChatCompletionMessage{
          {
             // The message role is user
             Role: model.ChatMessageRoleUser,
             Content: &model.ChatCompletionMessageContent{
                ListValue: contentParts, // Use ListValue for multi-type content
             },
          },
       },
       MaxTokens: byteplus.Int(300), // Set the maximum number of output tokens for the model
    }

    // Send the chat completion request, store the result in resp, and store possible errors in err
    resp, err := client.CreateChatCompletion(ctx, req)
    if err!= nil {
       // If an error occurs, print the error message and terminate the program
       fmt.Printf("standard chat error: %v\n", err)
       return
    }
    // Print the response result of the chat completion request
    fmt.Println(*resp.Choices[0].Message.Content.StringValue)
}
```



</Tab>
<Tab zoneid="qCY0tBKSrK" title="Java">
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

public class VideoSample {
  static String apiKey = System.getenv("ARK_API_KEY");
  static ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
  static Dispatcher dispatcher = new Dispatcher();
  static ArkService service = ArkService.builder()
      .dispatcher(dispatcher)
      .connectionPool(connectionPool)
      .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3")  // The base URL for model invocation .
      .apiKey(apiKey) //Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
      .build();

  public static void main(String[] args) throws Exception {

    List<ChatMessage> messagesForReqList = new ArrayList<>();

// Construct message content
    List<ChatCompletionContentPart> contentParts = new ArrayList<>();

    contentParts.add(ChatCompletionContentPart.builder()
        .type("video_url")
        .videoUrl(new ChatCompletionContentPartVideoURL(
            "https://ark-doc.tos-ap-southeast-1.bytepluses.com/video_understanding.mp4",2))

        .build());

    contentParts.add(ChatCompletionContentPart.builder()
        .type("text")
        .text("What's in the video?")
        .build());

// Create message
    messagesForReqList.add(ChatMessage.builder()
        .role(ChatMessageRole.USER)
        .multiContent(contentParts)
        .build());

    ChatCompletionRequest req = ChatCompletionRequest.builder()
        .model("seed-2-0-lite-260228") //Replace with Model ID .
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


<span id="fcee824a"></span>
## Video temporal perception

Video understanding can interpret the relationship between video time and images, such as answering time\-related questions like when an event occurs, at which timestamps a specific event happens, etc. For the working principle, see [How video understanding works](https://docs.byteplus.com/en/docs/ModelArk/1895586#b5f696d3).

Here are some simple code samples:


<Tabs>
<Tab zoneid="POQYsgglA6" title="Curl">
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
                {"type": "video_url","video_url": {"url":  "https://ark-doc.tos-ap-southeast-1.bytepluses.com/video_understanding.mp4", "fps": "5"}},
                {"type": "text", "text": "At what timestamp does the referee appear?"}
            ]
        }
    ],
    "max_tokens": 300
  }'
```



* Replace the Model ID as needed. To query the Model ID, see [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310).


</Tab>
<Tab zoneid="lQywGhPpbY" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
# Install SDK:  pip install byteplus-python-sdk-v2 .
from byteplussdkarkruntime import Ark 

client = Ark(
    # The base URL for model invocation .
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
)

completion = client.chat.completions.create(
    # Replace with Model ID .
    model = "seed-2-0-lite-260228",
    messages=[
        {
            # The message role is user
            "role": "user",
            "content": [
                {
                    "type": "video_url",
                    "video_url": {
                        # Replace the link with your actual video link
                        "url":  "https://ark-doc.tos-ap-southeast-1.bytepluses.com/video_understanding.mp4",
                        "fps": 5, # Capture 5 frames per second for video understanding
                    }
                },
                # Message of text type, asking what is in the video
                {"type": "text", "text": "At what timestamp does the referee appear?"},
            ],
        }
    ],
)

print(completion.choices[0])
```



</Tab>
<Tab zoneid="Z9Kgqw5ktn" title="Go">
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
        // Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
        os.Getenv("ARK_API_KEY"),
        // The base URL for model invocation .
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    // Create a context, which is usually used to pass request context information such as timeout, cancellation, etc.
    ctx := context.Background()
    // Build the message content
    contentParts := []*model.ChatCompletionMessageContentPart{
        {
            Type: "video_url",
            VideoURL: &model.ChatMessageVideoURL{
                URL: "https://ark-doc.tos-ap-southeast-1.bytepluses.com/video_understanding.mp4",
                FPS: byteplus.Float64(5),
            },
        },
        // Text content
        {
            Type: "text",
            Text: "At what timestamp does the referee appear?",
        },
    }
    // Construct a chat completion request, and set the model and message content for the request
    req := model.CreateChatCompletionRequest{
        // Replace with Model ID
       Model: "seed-2-0-lite-260228",
       Messages: []*model.ChatCompletionMessage{
          {
             // The message role is user
             Role: model.ChatMessageRoleUser,
             Content: &model.ChatCompletionMessageContent{
                ListValue: contentParts, // Use ListValue for multi-type content
             },
          },
       },
       MaxTokens: byteplus.Int(300), // Set the maximum number of output tokens for the model
    }

    // Send the chat completion request, store the result in resp, and store possible errors in err
    resp, err := client.CreateChatCompletion(ctx, req)
    if err!= nil {
       // If an error occurs, print the error message and terminate the program
       fmt.Printf("standard chat error: %v\n", err)
       return
    }
    // Print the response result of the chat completion request
    fmt.Println(*resp.Choices[0].Message.Content.StringValue)
}
```



</Tab>
<Tab zoneid="vmlSjg0a06" title="Java">
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

public class VideoSample {
  static String apiKey = System.getenv("ARK_API_KEY");
  static ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
  static Dispatcher dispatcher = new Dispatcher();
  static ArkService service = ArkService.builder()
      .dispatcher(dispatcher)
      .connectionPool(connectionPool)
      .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3")  // The base URL for model invocation .
      .apiKey(apiKey) //Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
      .build();

  public static void main(String[] args) throws Exception {

    List<ChatMessage> messagesForReqList = new ArrayList<>();

// Construct message content
    List<ChatCompletionContentPart> contentParts = new ArrayList<>();

    contentParts.add(ChatCompletionContentPart.builder()
        .type("video_url")
        .videoUrl(new ChatCompletionContentPartVideoURL(
            "https://ark-doc.tos-ap-southeast-1.bytepluses.com/video_understanding.mp4",5))
        .build());

    contentParts.add(ChatCompletionContentPart.builder()
        .type("text")
        .text("At what timestamp does the referee appear?")
        .build());

// Create message
    messagesForReqList.add(ChatMessage.builder()
        .role(ChatMessageRole.USER)
        .multiContent(contentParts)
        .build());

    ChatCompletionRequest req = ChatCompletionRequest.builder()
        .model("seed-2-0-lite-260228") //Replace with Model ID .
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


Response preview

```Plain
According to the video description, the referee appears around **3.7 seconds**. At that moment, the two boxers in the frame (the one on the left wears a black T-shirt and red shorts, the one on the right wears a white T-shirt and black shorts) were in a confrontation. Then the referee (wearing a black suit and white gloves) stood between the two, as if preparing to start the match or pause the current round, while the audience continued cheering in the background.
```


<span id="5cfd1f60"></span>
## Streaming output

Streaming output supports dynamic real\-time content presentation. It can not only ease users' waiting anxiety, but also avoid client timeout failures caused by long inference time for complex tasks, ensuring the smooth request process.


<Tabs>
<Tab zoneid="mE2FjQLFP7" title="Python SDK">
<TabTitle>Python SDK</TabTitle>

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
    # upload video file
    print("Upload video file")
    file = await client.files.create(
        # replace with your local video path
        file=open("/Users/doc/demo.mp4", "rb"),
        purpose="user_data",
        preprocess_configs={
            "video": {
                "fps": 0.3,  # define the sampling fps of the video, default is 1.0
            }
        }
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
                    "type": "input_video",
                    "file_id": file.id  # ref video file id
                },
                {
                    "type": "input_text",
                        "text": "Please describe the movement sequence of the characters in the video, and output the start time (start_time), end time (end_time), event (event), and danger status (danger) in JSON format. Please use HH:mm:ss to represent the timestamp."

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
<Tab zoneid="e00fMz3xat" title="Go SDK">
<TabTitle>Go SDK</TabTitle>

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
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/volcengine"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        // Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
        os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    ctx := context.Background()

    fmt.Println("----- upload video data -----")
    data, err := os.Open("/Users/doc/demo.mp4")
    if err != nil {
        fmt.Printf("read file error: %v\n", err)
        return
    }
    fileInfo, err := client.UploadFile(ctx, &file.UploadFileRequest{
        File:    data,
        Purpose: file.PurposeUserData,
        PreprocessConfigs: &file.PreprocessConfigs{
            Video: &file.Video{
                Fps: volcengine.Float64(0.3),
            },
        },
    })

    if err != nil {
        fmt.Printf("upload file error: %v", err)
        return
    }

    // Wait for the file to finish processing
    for fileInfo.Status == file.StatusProcessing {
        fmt.Println("Waiting for video to be processed...")
        time.Sleep(2 * time.Second)
        fileInfo, err = client.RetrieveFile(ctx, fileInfo.ID) // update file info
        if err != nil {
            fmt.Printf("get file status error: %v", err)
            return
        }
    }
    fmt.Printf("Video processing completed: %s, status: %s\n", fileInfo.ID, fileInfo.Status)
    inputMessage := &responses.ItemInputMessage{
        Role: responses.MessageRole_user,
        Content: []*responses.ContentItem{
            {
                Union: &responses.ContentItem_Video{
                    Video: &responses.ContentItemVideo{
                        Type:   responses.ContentItemType_input_video,
                        FileId: volcengine.String(fileInfo.ID),
                    },
                },
            },
            {
                Union: &responses.ContentItem_Text{
                    Text: &responses.ContentItemText{
                        Type: responses.ContentItemType_input_text,
                        Text: "Please describe the movement sequence of the characters in the video, and output the start time (start_time), end time (end_time), event (event), and danger status (danger) in JSON format. Please use HH:mm:ss to represent the timestamp.",
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
        fmt.Printf("stream error: %v\n", err)
        return
    }
    var responseId string
    for {
        event, err := resp.Recv()
        if err == io.EOF {
            break
        }
        if err != nil {
            fmt.Printf("stream error: %v\n", err)
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
        fmt.Printf("\nAggregated reasoning text: %s\n", event.GetReasoningText().GetText())
    case responses.EventType_response_output_text_delta.String():
        print(event.GetText().GetDelta())
    case responses.EventType_response_output_text_done.String(): // aggregated output text
        fmt.Printf("\nAggregated output text: %s\n", event.GetTextDone().GetText())
    default:
        return
    }
}
```



</Tab>
<Tab zoneid="JQ5KwTkSpB" title="Java SDK">
<TabTitle>Java SDK</TabTitle>

```Java
package com.ark.example;

import com.byteplus.ark.runtime.model.files.FileMeta;
import com.byteplus.ark.runtime.model.files.PreprocessConfigs;
import com.byteplus.ark.runtime.model.files.UploadFileRequest;
import com.byteplus.ark.runtime.model.files.Video;
import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.model.responses.request.*;
import com.byteplus.ark.runtime.model.responses.item.ItemEasyMessage;
import com.byteplus.ark.runtime.model.responses.constant.ResponsesConstants;
import com.byteplus.ark.runtime.model.responses.item.MessageContent;
import com.byteplus.ark.runtime.model.responses.content.InputContentItemVideo;
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
        // upload a video for responses
        FileMeta fileMeta;
        fileMeta = service.uploadFile(
                UploadFileRequest.builder().
                        file(new File("/Users/doc/demo.mp4")) // replace with your image file path
                        .purpose("user_data")
                        .preprocessConfigs(PreprocessConfigs.builder().video(new Video(0.3)).build())
                        .build());
        System.out.println("Uploaded file Meta: " + fileMeta);
        System.out.println("status:" + fileMeta.getStatus());

        try {
            while (fileMeta.getStatus().equals("processing")) {
                System.out.println("Waiting for video to be processed...");
                TimeUnit.SECONDS.sleep(2);
                fileMeta = service.retrieveFile(fileMeta.getId());
            }
        } catch (Exception e) {
>             System.err.println("get file status error: " + e.getMessage());
        }
        System.out.println("Uploaded file Meta: " + fileMeta);

        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .stream(true)
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder()
                                        .addListItem(InputContentItemVideo.builder().fileId(fileMeta.getId()).build())
                                        .addListItem(InputContentItemText.builder().text("Please describe the movement sequence of the characters in the video, and output the start time (start_time), end time (end_time), event (event), and danger status (danger) in JSON format. Please use HH:mm:ss to represent the timestamp.").build())
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
                        System.out.println("\nOutputItem " + (((OutputItemAddedEvent) event).getItem().getType()) + " Start: ");
                    }
                    if (event instanceof OutputTextDeltaEvent) {
                        System.out.print(((OutputTextDeltaEvent) event).getDelta());
                    }
                    if (event instanceof OutputTextDoneEvent) {
                        System.out.println("\nOutputText End.");
                    }
                    if (event instanceof OutputItemDoneEvent) {
                        System.out.println("\nOutputItem " + ((OutputItemDoneEvent) event).getItem().getType() + " End.");
                    }
                    if (event instanceof FunctionCallArgumentsDoneEvent) {
                        System.out.println("\nFunctionCall Arguments: " + ((FunctionCallArgumentsDoneEvent) event).getArguments());
                    }
                    if (event instanceof ResponseCompletedEvent) {
                        System.out.println("\nResponse Completed. Usage = " + ((ResponseCompletedEvent) event).getResponse().getUsage());
                    }
                });


        service.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="FEB9UAfqBd" title="OpenAI SDK">
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
    file=open("/Users/doc/demo.mp4", "rb"),
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
                    "type": "input_video",
                    "file_id": file.id,
                },
                {
                    "type": "input_text",
                     "text": "Please describe the movement sequence of the characters in the video, and output the start time (start_time), end time (end_time), event (event), and danger status (danger) in JSON format. Please use HH:mm:ss to represent the timestamp.",
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


<span id="c62696a9"></span>
# Instructions

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">tip</div>


<div data-tips="true" data-tips-type="tip">Processed images and videos will be deleted from the ModelArk server. ModelArk will not retain user data such as images, videos, and text information you submit for model training.</div>


<span id="c203cacb"></span>
## Temporal information

Video keyframes are obtained through FPS\-based frame sampling, then temporal information is marked by concatenating `timestamp + image`. The model achieves complete understanding of the video based on the timing marks and image content in the request, including content changes, movement logic, temporal correlation, etc.

For detailed principles, see [How video understanding works](https://docs.byteplus.com/en/docs/ModelArk/1895586#b5f696d3).

<span id="1d125314"></span>
## Supported video formats


|**Video format** |**File extension** |**Content Type** |
|---|---|---|
|MP4 |.mp4 |`video/mp4` |
|AVI |.avi |`video/avi` |
|MOV |.mov |* For videos passed via URL: Set the Content Type to `video/quicktime` in TOS<br><br>* For Base64 encoding: Use `video/mov`, that is `data:video/mov;base64,<BASE64_ENCODING>` |


> There are many variants of video file formats, so we cannot guarantee that all files can be recognized. Please verify that the files can be recognized as expected through testing.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">tip</div>



* <div data-tips="true" data-tips-type="tip">For FAQs, see <a href="https://docs.byteplus.com/en/docs/ModelArk/1359411#85251eec">Are video files in TS format supported?</a></div>


* <div data-tips="true" data-tips-type="tip">For configurations when uploading videos to TOS, see <a href="https://docs.byteplus.com/en/docs/tos/docs-managing-file-metadata">Documentation</a>.</div>


* <div data-tips="true" data-tips-type="tip">To pass Base64 string, refer to <a href="https://docs.byteplus.com/en/docs/ModelArk/1895586#22314028">Pass Base64 string</a>.</div>


* <div data-tips="true" data-tips-type="tip">Video formats must be in lowercase.</div>



<span id="4093d898"></span>
## About video size


* When passing videos via URL, a single video cannot exceed 50 MB.

* When passing videos via Base64 strings, a single video cannot exceed 50 MB, and the request body cannot exceed 64 MB.

* When uploading videos via the Files API and the files are stored in the TOS bucket of ModelArk, files up to 512 MB can be uploaded. When files are stored in your own TOS buckets, video files up to 2 GB can be uploaded to meet the needs for large files.


<span id="ae04f468"></span>
## **Audio understanding support**

Some models support understanding audio information in video files. See [Audio input embedded in videos](https://docs.byteplus.com/en/docs/ModelArk/2377589#0a9900d2) for details.

<span id="203baa92"></span>
## **Frame sampling strategy**

About token usage: The maximum token usage for a single video is 80k. The maximum token amount for a single request video is also limited by the model's maximum context window and maximum input length (when deep thinking is enabled). If the limit is exceeded, you need to adjust the number or duration of input videos.

Basic concepts:


* Frame image: A video frame at a certain moment, which specifically refers to the frame image input to the model in this article

* Number of frame images: Video duration in seconds \* **fps**


ModelArk compresses frame images based on the number of frame images to balance the video understanding accuracy and token usage.

Different models have different frame sampling strategies, as detailed below:


|Frame sampling strategy |Models before bytedance\-seed\-1.8 |bytedance\-seed\-1.8 model, bytedance\-seed\-2.0 model |
|---|---|---|
|Maximum tokens per frame |Discrete token values of 128, 160, 256, 384, 512, and 640 are supported. |* For Seed\-1.8 models: Discrete token values of 64, 128, 192, 256, 320, and 384 are supported.<br><br>* For Seed\-2.0 models: Tokens in the [64, 384] range are all supported. |
|Max pixels per frame |Maximum tokens per frame \* 28 \* 28<br><br>[10w, 50w] |Maximum tokens per frame \* 42 \* 42<br><br>[11w, 67w] |
|Number of sampled frames |[16 frames, 640 frames]<br><br>```Bash```<br>```# Maximum number of sampled frames```<br>``` 80×1024 tokens ÷ 128 tokens per frame = 640 frames```<br> |[16 frames, 1280 frames]<br><br>```Bash```<br>```# Maximum number of sampled frames```<br>``` 80×1024 tokens ÷ 64 tokens per frame = 1280 frames```<br> |
|Frame sampling scheme |<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">tip</div><br><br><br><br>* <div data-tips="true" data-tips-type="tip">It is recommended to evaluate the output quality and adjust the fps parameter configuration or video duration as needed.</div><br><br><br>* <div data-tips="true" data-tips-type="tip">If the video binary data does not contain frame count encoding information, frames will be evenly sampled according to fps. If the maximum token amount of video in a single request exceeds the model's maximum input length, an error will be reported. If it does not exceed the limit, no error will be reported, but the tokens of the video input may exceed 80k.</div><br> ||


<span id="b5f696d3"></span>
# How video understanding works

The core method of video processing is "structured concatenation of frames and timestamps", with the following specific rules:


* For each frame image sampled from the video, insert timestamp text before it in the format of `[<timestamp> second]`.

* After concatenation, an ordered sequence of "timestamp + image" is formed, and the model understands the temporal logic and content changes of the video through this sequence.


<span id="245b775b"></span>
## Examples of frame sampling


|FPS 1 |FPS 0.5 |FPS 2 | |
|---|---|---|---|
|Timestamp |[0.0 second] |[0.0 second] |[0.0 second] |
|Video frame |`<IMAGE>` |`<IMAGE>` |`<IMAGE>` |
|Timestamp |[1.0 second] |[2.0 second] |[0.5 second] |
|Video frame |`<IMAGE>` |`<IMAGE>` |`<IMAGE>` |
|Timestamp |[2.0 second] |[4.0 second] |[1.0 second] |
|Video frame |`<IMAGE>` |`<IMAGE>` |`<IMAGE>` |
|Timestamp |[3.0 second] ||[1.5 second] |
|Video frame |`<IMAGE>` ||`<IMAGE>` |
|Timestamp |[4.0 second] ||[2.0 second] |
|Video frame |`<IMAGE>` ||`<IMAGE>` |
|Timestamp |[5.0 second] ||[2.5 second] |
|Video frame |`<IMAGE>` ||`<IMAGE>` |
|Timestamp |||[3.0 second] |
|Video frame |||`<IMAGE>` |
|Timestamp |||[3.5 second] |
|Video frame |||`<IMAGE>` |
|Timestamp |||[4.0 second] |
|Video frame |||`<IMAGE>` |
|Timestamp |||[4.5 second] |
|Video frame |||`<IMAGE>` |
|Timestamp |||[5.0 second] |
|Video frame |||`<IMAGE>` |
|*Total 6 frames* |*Total 3 frames* |*Total 11 frames* | |


<span id="8646a93e"></span>
## Equivalent multi\-image request

A video understanding request is equivalent to the multi\-image understanding request shown in the example below.

```Plain
{
    "model": "seed-2-0-lite-260228",
    "messages": [
        {
            "role": "user",
            "content": [
                {
                    "type":"text",
                    "text":"Do you think this is scary?"
                },
                {
                    "type":"text",
                    "text":"[0.0 second]"
                },
                {
                    "type":"image_url",
                    "image_url":{
                        "url":"<image_url_01>"}
                },
                {
                    "type":"text",
                    "text":"[1.0 second]"
                },
                {
                    "type":"image_url",
                    "image_url":{
                        "url":"<image_url_02>"}
                },
                {
                    "type":"text",
                    "text":"[2.0 second]"
                },
                {
                    "type":"image_url",
                    "image_url":{
                        "url":"<image_url_03>"}
                },
                {
                    "type":"text",
                    "text":"[3.0 second]"
                },
                {
                    "type":"image_url",
                    "image_url":{
                        "url":"<image_url_04>"}
                },
                {
                    "type":"text",
                    "text":"[4.0 second]"
                },
                {
                    "type":"image_url",
                    "image_url":{
                        "url":"<image_url_05>"}
                },
                {
                    "type":"text",
                    "text":"[5.0 second]"
                },
                {
                    "type":"image_url",
                    "image_url":{
                        "url":"<image_url_06>"}
                }
            ]
        }
    ]
}
```




