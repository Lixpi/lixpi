You can upload, retrieve, list, and delete files using the Files API.

In multimodal understanding scenarios, the Files API is used together with the Responses API and Chat API to provide the following benefits:


* Large file support: When files are stored in the default hosted storage space of ModelArk, files up to 512 MB can be uploaded. When files are stored in the TOS buckets you specified, video files up to 2 GB can be uploaded to meet the needs for large files.

* Reuse: Supports reusing files across multiple requests through the File ID, avoiding repeated uploads and reducing public network download latency.

* Shorter inference time: Decouples data preprocessing from model inference, avoids uploading content repeatedly for each request, and reduces latency caused by preprocessing.


<span id="62e9d75a"></span>
# Prerequisites

[Obtain an API key](https://console.byteplus.com/ark/apiKey)

<span id="c4765823"></span>
# API documentation

[Files API reference](https://docs.byteplus.com/en/docs/ModelArk/1870405)

<span id="821e2a5c"></span>
# Files API usage examples

<span id="963e0807"></span>
## Upload a file

You can use the Files API to upload files such as images, videos, audio, and documents. After the upload succeeds, a file ID is returned. The file ID can be reused across multiple requests without uploading the content again, reducing public network download latency. If the file is larger than 50 MB, or if you want to reuse the file across multiple requests, you can upload the file using the Files API and then use the file ID to initiate requests.

The file storage location is determined by the `tos` parameter in the request. For details, see the parameter descriptions in [Upload file](https://docs.byteplus.com/en/docs/ModelArk/1870405):


* If the `tos` parameter is not passed: The file is stored in the default managed storage space of ModelArk.

* If the `tos` parameter is passed: The file is stored in the BytePlus TOS bucket specified by the user.

> The target BytePlus TOS bucket can be used only after authorization is completed in the console. For details, see [User TOS authorization](https://docs.byteplus.com/en/docs/ModelArk/1529797#4eb1b277).


<span id="file-upload-methods"></span>
### File upload methods

The Files API supports uploading files in two ways: binary files and file URLs.


* `file` (binary file): The local file to upload. Files can be stored in the default managed storage space of ModelArk or a BytePlus TOS bucket specified by the user.

* `url` (file URL): Supports HTTP/HTTPS URLs and TOS URIs.

* HTTP/HTTPS URL: A file URL that can be directly accessed over the public internet. Make sure the file URL is accessible. Files can be stored in the default managed storage space of ModelArk or a BytePlus TOS bucket specified by the user.

   * TOS URI: A resource location identifier specific to TOS, in the format `tos://<bucket>/<prefix>/<file_name>`. When this method is used, files can only be stored in a BytePlus TOS bucket.


<span id="upload-files"></span>
#### Upload files


* Store files in the default managed storage space of ModelArk

   
   <Tabs>
   <Tab zoneid="TkoHXkPZQY" title="Curl">
   <TabTitle>Curl</TabTitle>
   
   ```Bash
   curl https://ark.ap-southeast.bytepluses.com/api/v3/files \
   -H "Authorization: Bearer $ARK_API_KEY" \
   -F 'purpose=user_data' \
   -F 'file=@/Users/doc/demo.mp4' \
   -F 'preprocess_configs[video][fps]=0.3'
   ```
   
   
   The response parameters are as follows:
   
   ```Bash
   {
       "object": "file",
       "id": "file-20251018114827-6zgrb",
       "purpose": "user_data",
       "filename": "demo.mp4",
       "bytes": 695110,
       "mime_type": "video/mp4",
       "created_at": 1760759307,
       "expire_at": 1761364107,
       "status": "processing",
       "preprocess_configs": {
           "video": {
               "fps": 0.3
           }
       }
   }
   ```
   
   
   
   </Tab>
   <Tab zoneid="hiqucISwgm" title="Python SDK">
   <TabTitle>Python SDK</TabTitle>
   
   ```Python
   import os
   from byteplussdkarkruntime import Ark
   
   client = Ark(
       base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
       api_key=os.getenv('ARK_API_KEY')
   )
   
   file = client.files.create(
       # replace with your local video path
       file=open("/Users/doc/demo.mp4", "rb"),
       purpose="user_data",
       preprocess_configs={
           "video": {
               "fps": 0.3,  # define the sampling fps of the video, default is 1.0
           }
       }
   )
   print(file)
   ```
   
   
   
   </Tab>
   <Tab zoneid="Kpd9xVeMGF" title="Go SDK">
   <TabTitle>Go SDK</TabTitle>
   
   ```Go
   package main
   
   import (
       "context"
       "fmt"
       "os"
   
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/file"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
   )
   
   func main() {
       client := arkruntime.NewClientWithApiKey(
           os.Getenv("ARK_API_KEY"),
           arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
       )
       ctx := context.Background()
   
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
                   Fps: byteplus.Float64(0.3),
               },
           },
       })
   
       if err != nil {
           fmt.Printf("upload file error: %v", err)
           return
       }
       fmt.Printf("file info: %v\n", fileInfo)
   
   }
   ```
   
   
   
   </Tab>
   <Tab zoneid="s7avUq9u5P" title="Java SDK">
   <TabTitle>Java SDK</TabTitle>
   
   ```Java
   package com.ark.sample;
   
   import com.byteplus.ark.runtime.model.files.FileMeta;
   import com.byteplus.ark.runtime.model.files.PreprocessConfigs;
   import com.byteplus.ark.runtime.model.files.UploadFileRequest;
   import com.byteplus.ark.runtime.model.files.Video;
   import com.byteplus.ark.runtime.service.ArkService;
   import java.io.File;
   
   public class demo {
   
       public static void main(String[] args) {
           String apiKey = System.getenv("ARK_API_KEY");
           ArkService service = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();
   
           System.out.println("===== Upload File Example=====");
           FileMeta fileMeta;
           fileMeta = service.uploadFile(
                   UploadFileRequest.builder().
                           file(new File("/Users/doc/demo.mp4")) // replace with your image file path
                           .purpose("user_data")
                           .preprocessConfigs(PreprocessConfigs.builder().video(new Video(0.3)).build())
                           .build());
           System.out.println("Uploaded file Meta: " + fileMeta);
   
           service.shutdownExecutor();
       }
   }
   ```
   
   
   
   </Tab>
   <Tab zoneid="x7axe5Lya6" title="OpenAI SDK">
   <TabTitle>OpenAI SDK</TabTitle>
   
   ```Python
   import os
   from openai import OpenAI
   
   client = OpenAI(
       base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
       api_key=os.getenv('ARK_API_KEY')
   )
   
   file = client.files.create(
       # replace with your local video path
       file=open("/Users/doc/demo.mp4", "rb"),
       purpose="user_data",
       extra_body={
           "preprocess_configs":{
               "video": {
                   "fps": 0.3
               }
           }
       }
   )
   print(file)
   ```
   
   
   
   </Tab>
   </Tabs>
   

* Store the file in a BytePlus TOS bucket:

   
   <Tabs>
   <Tab zoneid="DnW7qJHPen" title="Curl">
   <TabTitle>Curl</TabTitle>
   
   ```Bash
   curl https://ark.ap-southeast.bytepluses.com/api/v3/files \
   -H "Authorization: Bearer $ARK_API_KEY" \
   -F 'purpose=user_data' \
   -F 'file=@/Users/doc/demo.mp4' \
   -F 'preprocess_configs[video][fps]=0.3' \
   -F "tos[bucket]=my-bucket" \
   -F "tos[prefix]=ark-files/"
   ```
   
   
   
   </Tab>
   <Tab zoneid="X3BvCYcThj" title="Python SDK">
   <TabTitle>Python SDK</TabTitle>
   
   ```Python
   import os
   from byteplussdkarkruntime import Ark
   
   client = Ark(
       base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
       api_key=os.getenv('ARK_API_KEY')
   )
   
   file = client.files.create(
       file=open("/Users/doc/demo.mp4", "rb"),
       purpose="user_data",
       preprocess_configs={
           "video": {
               "fps": 0.3
           }
       },
       tos={
           "bucket": "my-bucket",
           "prefix": "ark-files/"
       }
   )
   print(file)
   ```
   
   
   
   </Tab>
   <Tab zoneid="jsQ465Q7FL" title="Go SDK">
   <TabTitle>Go SDK</TabTitle>
   
   ```Go
   package main
   
   import (
       "context"
       "fmt"
       "os"
   
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/file"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/volcengine"
   )
   
   func main() {
       client := arkruntime.NewClientWithApiKey(
           os.Getenv("ARK_API_KEY"),
           arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
       )
       ctx := context.Background()
   
       data, err := os.Open("/Users/doc/demo.mp4")
       if err != nil {
           fmt.Printf("read file error: %v\n", err)
           return
       }
   
       fileInfo, err := client.UploadFile(ctx, &file.UploadFileRequest{
           File:    data,
           Purpose: file.PurposeUserData,
           Tos: &file.TosStorage{
               Bucket: byteplus.String("my-bucket"),
               Prefix: byteplus.String("ark-files/"),
           },
           PreprocessConfigs: &file.PreprocessConfigs{
               Video: &file.Video{
                   Fps: byteplus.Float64(0.3),
               },
           },
       })
       if err != nil {
           fmt.Printf("upload file error: %v", err)
           return
       }
       fmt.Printf("file info: %v\n", fileInfo)
   }
   ```
   
   
   
   </Tab>
   <Tab zoneid="hT7OtMeFjN" title="Java SDK">
   <TabTitle>Java SDK</TabTitle>
   
   ```Java
   package com.ark.sample;
   
   import com.byteplus.ark.runtime.model.files.*;
   import com.byteplus.ark.runtime.service.ArkService;
   import java.io.File;
   
   public class demo {
   
       public static void main(String[] args) {
           String apiKey = System.getenv("ARK_API_KEY");
           ArkService service = ArkService.builder()
                   .apiKey(apiKey)
                   .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3")
                   .build();
   
           System.out.println("===== Upload File Example =====");
           FileMeta fileMeta;
           fileMeta = service.uploadFile(
                   UploadFileRequest.builder()
                           .file(new File("/Users/doc/demo.mp4"))
                           .purpose("user_data")
                           .tos(TosStorage.builder()
                                   .bucket("my-bucket")
                                   .prefix("ark-files/")
                                   .build())
                           .preprocessConfigs(PreprocessConfigs.builder()
                                   .video(new Video(0.3))
                                   .build())
                           .build());
           System.out.println("Uploaded file Meta: " + fileMeta);
   
           service.shutdownExecutor();
       }
   }
   ```
   
   
   
   </Tab>
   </Tabs>
   


<span id="upload-via-http-https-url"></span>
#### Upload via HTTP/HTTPS URL


* Store files in the default managed storage space of ModelArk

   
   <Tabs>
   <Tab zoneid="ClvKFW13yp" title="Curl">
   <TabTitle>Curl</TabTitle>
   
   ```Bash
   curl -X POST "https://ark.ap-southeast.bytepluses.com/api/v3/files" \
     -H "Authorization: Bearer $ARK_API_KEY" \
     -F "purpose=user_data" \
     -F "url=https://example.com/docs/demo_img.png"
   ```
   
   
   
   </Tab>
   <Tab zoneid="zDVwRvoY0P" title="Python SDK">
   <TabTitle>Python SDK</TabTitle>
   
   ```Python
   import os
   from byteplussdkarkruntime import Ark
   
   client = Ark(
       base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
       api_key=os.getenv('ARK_API_KEY')
   )
   
   file = client.files.create(
       purpose="user_data",
       url="https://example.com/docs/demo_img.png"
   )
   print(file)
   
   ```
   
   
   
   </Tab>
   <Tab zoneid="vgy8iqJA4v" title="Go SDK">
   <TabTitle>Go SDK</TabTitle>
   
   ```Go
   package main
   
   import (
       "context"
       "fmt"
       "os"
   
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/file"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/volcengine"
   )
   
   func main() {
       client := arkruntime.NewClientWithApiKey(
           os.Getenv("ARK_API_KEY"),
           arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
       )
       ctx := context.Background()
   
       fileInfo, err := client.UploadFile(ctx, &file.UploadFileRequest{
           Purpose: file.PurposeUserData,
           URL:     byteplus.String("https://example.com/docs/demo_img.png"),
       })
   
       if err != nil {
           fmt.Printf("upload file error: %v", err)
           return
       }
       fmt.Printf("file info: %v\n", fileInfo)
   }
   
   ```
   
   
   
   </Tab>
   <Tab zoneid="mkf1U5zOf8" title="Java SDK">
   <TabTitle>Java SDK</TabTitle>
   
   ```Java
   package com.ark.sample;
   
   import com.byteplus.ark.runtime.model.files.*;
   import com.byteplus.ark.runtime.service.ArkService;
   
   public class demo {
       public static void main(String[] args) {
           String apiKey = System.getenv("ARK_API_KEY");
           ArkService service = ArkService.builder()
                   .apiKey(apiKey)
                   .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3")
                   .build();
   
           System.out.println("===== Upload File Example =====");
           FileMeta fileMeta;
           try {
               fileMeta = service.uploadFile(
                       UploadFileRequest.builder()
                               .url("https://example.com/docs/demo_img.png")
                               .purpose("user_data")
                               .build());
               System.out.println("Uploaded file Meta: " + fileMeta);
           } catch (Exception e) {
               e.printStackTrace();
           }
   
           service.shutdownExecutor();
       }
   }
   ```
   
   
   
   </Tab>
   </Tabs>
   

* Store files in a BytePlus TOS Bucket

   
   <Tabs>
   <Tab zoneid="Mwiyh5awRL" title="Curl">
   <TabTitle>Curl</TabTitle>
   
   ```Bash
   curl -X POST "https://ark.ap-southeast.bytepluses.com/api/v3/files" \
   -H "Authorization: Bearer $ARK_API_KEY" \
   -F "purpose=user_data" \
   -F "url=https://example.com/docs/demo_img.png" \
   -F "tos[bucket]=my-bucket" \
   -F "tos[prefix]=ark-files/"
   ```
   
   
   
   </Tab>
   <Tab zoneid="OuIr1ECR6j" title="Python SDK">
   <TabTitle>Python SDK</TabTitle>
   
   ```Python
   import os
   from byteplussdkarkruntime import Ark
   
   client = Ark(
       base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
       api_key=os.getenv('ARK_API_KEY')
   )
   
   file = client.files.create(
       url="https://example.com/docs/demo_img.png",
       purpose="user_data",
       tos={
           "bucket": "my-bucket",
           "prefix": "ark-files/"
       }
   )
   print(file)
   ```
   
   
   
   </Tab>
   <Tab zoneid="YG4UpZsT3O" title="Go SDK">
   <TabTitle>Go SDK</TabTitle>
   
   ```Go
   package main
   
   import (
       "context"
       "fmt"
       "os"
   
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/file"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/volcengine"
   )
   
   func main() {
       client := arkruntime.NewClientWithApiKey(
           os.Getenv("ARK_API_KEY"),
           arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
       )
       ctx := context.Background()
   
       fileInfo, err := client.UploadFile(ctx, &file.UploadFileRequest{
           Purpose: file.PurposeUserData,
           URL:     byteplus.String("https://example.com/docs/demo_img.png"),
           Tos: &file.TosStorage{
               Bucket: byteplus.String("my-bucket"),
               Prefix: byteplus.String("ark-files/"),
           },
       })
       if err != nil {
           fmt.Printf("upload file error: %v", err)
           return
       }
       fmt.Printf("file info: %v\n", fileInfo)
   }
   ```
   
   
   
   </Tab>
   <Tab zoneid="sDHmb0Dh7v" title="Java SDK">
   <TabTitle>Java SDK</TabTitle>
   
   ```Java
   package com.ark.sample;
   
   import com.byteplus.ark.runtime.model.files.*;
   import com.byteplus.ark.runtime.service.ArkService;
   
   public class demo {
   
       public static void main(String[] args) {
           String apiKey = System.getenv("ARK_API_KEY");
           ArkService service = ArkService.builder()
                   .apiKey(apiKey)
                   .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3")
                   .build();
   
           System.out.println("===== Upload File Example =====");
           FileMeta fileMeta;
           try {
               fileMeta = service.uploadFile(
                       UploadFileRequest.builder()
                               .url("https://example.com/docs/demo_img.png")
                               .purpose("user_data")
                               .tos(TosStorage.builder()
                                       .bucket("my-bucket")
                                       .prefix("ark-files/")
                                       .build())
                               .build());
               System.out.println("Uploaded file Meta: " + fileMeta);
           } catch (Exception e) {
               e.printStackTrace();
           }
   
           service.shutdownExecutor();
       }
   }
   ```
   
   
   
   </Tab>
   </Tabs>
   


<span id="upload-via-tos-uri"></span>
#### Upload via TOS URI

When you pass a TOS URI, the file must be stored in a BytePlus TOS bucket. Note the following:


* `url` specifies the location of the source file to read, that is, an existing file in a BytePlus TOS bucket.

* `tos[bucket]` and `tos[prefix]` specify the bucket and storage path for uploading the file to a BytePlus TOS bucket.



<Tabs>
<Tab zoneid="BjPt5TBzMe" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
curl -X POST "https://ark.ap-southeast.bytepluses.com/api/v3/files" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -F "purpose=user_data" \
  -F "url=tos://my-bucket/source/raw_video.mp4" \
  -F "tos[bucket]=my-bucket" \
  -F "tos[prefix]=ark-files/"
```



</Tab>
<Tab zoneid="ZPjLJs8jvo" title="Python SDK">
<TabTitle>Python SDK</TabTitle>

```Python
import os
from byteplussdkarkruntime import Ark

client = Ark(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=os.getenv('ARK_API_KEY')
)

file = client.files.create(
    url="tos://my-bucket/source/raw_video.mp4",
    purpose="user_data",
    tos={
        "bucket": "my-bucket",
        "prefix": "ark-files/"
    }
)
print(file)
```



</Tab>
<Tab zoneid="m1tEEx1Rvk" title="Go SDK">
<TabTitle>Go SDK</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/file"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/volcengine"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    ctx := context.Background()

    fileInfo, err := client.UploadFile(ctx, &file.UploadFileRequest{
        Purpose: file.PurposeUserData,
        URL:     byteplus.String("tos://my-bucket/source/raw_video.mp4"),
        Tos: &file.TosStorage{
            Bucket: byteplus.String("my-bucket"),
            Prefix: byteplus.String("ark-files/"),
        },
    })
    if err != nil {
        fmt.Printf("upload file error: %v", err)
        return
    }
    fmt.Printf("file info: %v\n", fileInfo)
}
```



</Tab>
<Tab zoneid="ErEXjgqrmy" title="Java SDK">
<TabTitle>Java SDK</TabTitle>

```Java
package com.ark.sample;

import com.byteplus.ark.runtime.model.files.*;
import com.byteplus.ark.runtime.service.ArkService;

public class demo {

    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        ArkService service = ArkService.builder()
                .apiKey(apiKey)
                .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3")
                .build();

        System.out.println("===== Upload File Example =====");
        FileMeta fileMeta;
        try {
            fileMeta = service.uploadFile(
                    UploadFileRequest.builder()
                            .url("tos://my-bucket/source/raw_video.mp4")
                            .purpose("user_data")
                            .tos(TosStorage.builder()
                                    .bucket("my-bucket")
                                    .prefix("ark-files/")
                                    .build())
                            .build());
            System.out.println("Uploaded file Meta: " + fileMeta);
        } catch (Exception e) {
            e.printStackTrace();
        }

        service.shutdownExecutor();
    }
}
```



</Tab>
</Tabs>


In video understanding scenarios involving large videos, when you upload through the Files API by using `url` and pass the `tos` parameter, a single video file can be up to 2 GB (applies only to video files; other file types are still up to 512 MB). After the file is uploaded, it enters an asynchronous processing flow. You can use it only after the file status changes to active.


<Tabs>
<Tab zoneid="AOea9LfATy" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
curl -X POST "https://ark.ap-southeast.bytepluses.com/api/v3/files" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -F "purpose=user_data" \
  -F "url=tos://my-bucket/videos/long-video.mp4" \
  -F "tos[bucket]=my-bucket" \
  -F "tos[prefix]=ark-files/" \
  -F "preprocess_configs[video][max_video_tokens]=200000" \
  -F "preprocess_configs[video][min_frames]=16"
```



</Tab>
<Tab zoneid="unf4NSQBiy" title="Python SDK">
<TabTitle>Python SDK</TabTitle>

```Python
import os
from byteplussdkarkruntime import Ark

client = Ark(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=os.getenv('ARK_API_KEY')
)

file = client.files.create(
    url="tos://my-bucket/videos/long-video.mp4",
    purpose="user_data",
    tos={
        "bucket": "my-bucket",
        "prefix": "ark-files/"
    },
    preprocess_configs={
        "video": {
            "max_video_tokens": 200000,
            "min_frames": 16
        }
    }
)
print(file)
```



</Tab>
<Tab zoneid="D8r2iO8AWc" title="Go SDK">
<TabTitle>Go SDK</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/file"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/volcengine"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    ctx := context.Background()

    fileInfo, err := client.UploadFile(ctx, &file.UploadFileRequest{
        Purpose: file.PurposeUserData,
        URL:     byteplus.String("tos://my-bucket/videos/long-video.mp4"),
        Tos: &file.TosStorage{
            Bucket: byteplus.String("my-bucket"),
            Prefix: byteplus.String("ark-files/"),
        },
        PreprocessConfigs: &file.PreprocessConfigs{
            Video: &file.Video{
                MaxVideoTokens: byteplus.Int64(200000),
                MinFrames:      byteplus.Int64(16),
            },
        },
    })
    if err != nil {
        fmt.Printf("upload file error: %v", err)
        return
    }
    fmt.Printf("file info: %v\n", fileInfo)
}
```



</Tab>
<Tab zoneid="V3AeC0dwwp" title="Java SDK">
<TabTitle>Java SDK</TabTitle>

```Java
package com.ark.sample;

import com.byteplus.ark.runtime.model.files.*;
import com.byteplus.ark.runtime.service.ArkService;

public class demo {

    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        ArkService service = ArkService.builder()
                .apiKey(apiKey)
                .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3")
                .build();

        System.out.println("===== Upload File Example =====");
        FileMeta fileMeta;
        try {
            fileMeta = service.uploadFile(
                    UploadFileRequest.builder()
                            .url("tos://my-bucket/videos/long-video.mp4")
                            .purpose("user_data")
                            .tos(TosStorage.builder()
                                    .bucket("my-bucket")
                                    .prefix("ark-files/")
                                    .build())
                            .preprocessConfigs(PreprocessConfigs.builder()
                                    .video(Video.builder()
                                            .maxVideoTokens(200000L)
                                            .minFrames(16L)
                                            .build())
                                    .build())
                            .build());
            System.out.println("Uploaded file Meta: " + fileMeta);
        } catch (Exception e) {
            e.printStackTrace();
        }

        service.shutdownExecutor();
    }
}
```



</Tab>
</Tabs>


<span id="d75377d6"></span>
### File storage limits


<span aceTableMode="list" aceTableWidth="1,2,2"></span>
|Comparison item |Default storage space managed by ModelArk |BytePlus TOS bucket |
|---|---|---|
|Authorization requirements |No additional authorization is required. |The bucket must be authorized before it can be used as the storage target. See [User TOS authorization](https://docs.byteplus.com/en/docs/ModelArk/1529797#4eb1b277). |
|Single file size |512 MB |2 GB for video files, and 512 MB for other file types. |
|Total storage capacity |20 GB |No limit |
|Storage duration |Stored for 7 days by default. You can customize the storage validity period by using the **expire_at** parameter. The value range is 1 to 30 days.<br><br>> If you have frequent storage needs, we recommend that you actively manage storage space by shortening the file storage duration and proactively calling the deletion API to clean up inactive files. |Stored for 7 days by default. You can customize the storage validity period by using the **expire_at** parameter. The value range is 1 to 30 days. |
|Object operation limits |Call the Files API to delete the file. See [Delete file](https://docs.byteplus.com/en/docs/ModelArk/1870408). |After an object is managed, it can only be read. You cannot delete, overwrite, or modify the object through the TOS console or TOS API. Asynchronous write, delete, and modify operations that affect the object, such as lifecycle deletion and overwrite copy, are also subject to managed protection restrictions. Call the Files API to delete the file. See [Delete file](https://docs.byteplus.com/en/docs/ModelArk/1870408). |


<span id="fd98059d"></span>
### File preprocessing

When you upload files by using the Files API, the API preprocesses the files based on the uploaded file type.


* Video files: By default, frames are extracted at a rate of 1 frame per second. You can set a custom frame rate with the **preprocess_configs.video.fps** parameter. For long videos with little visual change, you can set a lower FPS value. If you need to capture visual changes in detail, you can set a higher FPS value. You can also use `min_frame_tokens`, `max_frame_tokens`, and `max_video_tokens` to control the compression strategy for individual frames and the overall video information retention strategy. After file preprocessing, using the File ID in the Responses API can reduce inference latency.

* PDF files: PDF files are processed page by page into multiple images. During preprocessing, the split images are not scaled in resolution, so that the original information in the PDF file can be preserved completely and clearly.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">When the <code>tos</code> parameter is passed, file preprocessing outputs are saved to the TOS path specified by the parameter. For example, if <code>tos[bucket]=my-bucket</code> and <code>tos[prefix]=ark-files/</code> are configured in the request, the preprocessing outputs are stored in the <code>my-bucket/ark-files/ark_processed/{file_id}/</code> directory, where <code>{file_id}</code> is the ID of the file uploaded this time.</div>


<span id="82fa7a9c"></span>
### Preprocessing timeout limit

The timeout limit for file preprocessing by using the Files API is 5 minutes. Timeouts are usually affected by factors such as video duration, number of PDF pages, pixels per page, pixels per frame, and audio duration.

**Timeout solutions**:

First, check whether the file resolution is too high. For example, frame extraction from 1080p videos can easily cause timeouts, so we recommend compressing videos to 720p or lower.

> The file resolution will be compressed in the model inference stage anyway, so using files of ultra high resolution does not help.


**Video compression tools and commands**

The following is an example command for compressing a video file to 720p. To download the FFmpeg tool, see [Download FFmpeg](http://ffmpeg.org/download.html).

```Bash
ffmpeg -i input.mp4 \
  -vf "scale=1280:720" \
  -c:v libx264 -crf 23 \
  -c:a aac -b:a 128k \
  output_720p.mp4
```


<span id="81920512"></span>
### File types

The Files API supports multiple file types, as described below.


<span aceTableMode="list" aceTableWidth="1,2,2"></span>
|File type |File format |MIME type |
|---|---|---|
|Image |.jpg, .jpeg, .png, .gif, .webp, .bmp, .tiff, .ico, .icns, .sgi, .jp2, .heic, .heif |`image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/bmp`, `image/tiff`, `image/x-icon`, `image/icns`, `image/sgi`, `image/jp2`, `image/heic`, `image/heif` |
|Video |.mp4, .avi, .mov |`video/mp4`, `video/avi`, `video/mov` |
|Document |.pdf |`application/pdf` |
|Audio |.mp3, .wav, .aac, .m4a |`audio/mpeg`, `audio/wav`, `audio/aac`, `audio/m4a` |


<span id="91473606"></span>
## Manage files

<span id="retrieve-a-file"></span>
### Retrieve a file

You can retrieve file information by file ID, such as file size, expiration time, MIME type, and file processing status. For details, see [Retrieve file](https://docs.byteplus.com/en/docs/ModelArk/1870406).

> After a file is uploaded successfully, the preprocessing is automatically triggered. After the API returns `file_id`, you can call the retrieve file API to query the file processing status. Only when `status` changes to `active` can you use `file_id` in the Responses API and Chat API for multimodal understanding.



<Tabs>
<Tab zoneid="ZfqoTsnX1g" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/files/file-20251014**** \
-H "Authorization: Bearer $ARK_API_KEY"
```



</Tab>
<Tab zoneid="gFAh2VTyT0" title="Python SDK">
<TabTitle>Python SDK</TabTitle>

```Python
import os
from byteplussdkarkruntime import Ark

# Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
api_key = os.getenv('ARK_API_KEY')

client = Ark(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

# Retrieve file
response = client.files.retrieve(
    file_id="file-2025******"
)

print(response)
```



</Tab>
<Tab zoneid="IcwLQ7dafC" title="Go SDK">
<TabTitle>Go SDK</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
)

func main() {
    client := arkruntime.NewClientWithApiKey(os.Getenv("ARK_API_KEY"),arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"))
    ctx := context.Background()

    fileInfo, err := client.RetrieveFile(ctx, "file-20251114****") // update file info
    if err != nil {
        fmt.Printf("get file status error: %v", err)
        return
    }
    fmt.Printf("file info: %v", fileInfo)

}
```



</Tab>
<Tab zoneid="FspCHMgXoA" title="Java SDK">
<TabTitle>Java SDK</TabTitle>

```Java
package com.ark.sample;

import com.byteplus.ark.runtime.model.files.FileMeta;
import com.byteplus.ark.runtime.service.ArkService;

public class demo {
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        ArkService service = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

        // Retrieve file
        FileMeta fileMeta = service.retrieveFile("file-20251117****");
        System.out.println("Retrieve File:" + fileMeta);

        service.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="YNNt3RpKYs" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
import os
from openai import OpenAI

api_key = os.getenv('ARK_API_KEY')

client = OpenAI(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

response = client.files.retrieve(
    file_id="file-20251117****"
)

print(response)
```



</Tab>
</Tabs>


<span id="34f747b5"></span>
### List files

Use the Files API to query the list of uploaded files. For details, see the [List files](https://docs.byteplus.com/en/docs/ModelArk/1870407) API reference.


<Tabs>
<Tab zoneid="mphoy8U6yh" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/files \
-H "Authorization: Bearer $ARK_API_KEY"
```



</Tab>
<Tab zoneid="gPsSXJNuP1" title="Python SDK">
<TabTitle>Python SDK</TabTitle>

```Python
import os
from byteplussdkarkruntime import Ark

api_key = os.getenv('ARK_API_KEY')

client = Ark(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

response = client.files.list()

print(response)
```



</Tab>
<Tab zoneid="JyAWHPnC7P" title="Go SDK">
<TabTitle>Go SDK</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/file"
)

func main() {
    client := arkruntime.NewClientWithApiKey(os.Getenv("ARK_API_KEY"),arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),)
    ctx := context.Background()

    fileInfo, err := client.ListFiles(ctx, &file.ListFilesRequest{}) 
    if err != nil {
        fmt.Printf("get file List error: %v", err)
        return
    }
    fmt.Printf("file List: %v", fileInfo)
}
```



</Tab>
<Tab zoneid="TERTrxxUEI" title="Java SDK">
<TabTitle>Java SDK</TabTitle>

```Java
package com.ark.sample;

import com.byteplus.ark.runtime.model.files.ListFilesResponse;
import com.byteplus.ark.runtime.model.files.ListFilesRequest;
import com.byteplus.ark.runtime.service.ArkService;

public class demo {
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        ArkService service = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

        ListFilesRequest request = new ListFilesRequest();
        ListFilesResponse ListFiles = service.listFiles(request);
        System.out.println("List Files:" + ListFiles);

        service.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="ZVkr1SFwjv" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
import os
from openai import OpenAI

api_key = os.getenv('ARK_API_KEY')

client = OpenAI(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

response = client.files.list()

print(response)
```



</Tab>
</Tabs>


<span id="9eb4f3d2"></span>
### Delete files

The Delete file API deletes a file by file ID and removes it from the storage space. For more information, see [Delete file](https://docs.byteplus.com/en/docs/ModelArk/1870408).

If you have frequent storage needs, you can manage storage space as follows. For details of storage limits, see [File storage limits](https://docs.byteplus.com/en/docs/ModelArk/1885708#d75377d6).


* Shorten file storage duration: Successfully uploaded files are stored for 7 days by default. You can customize the storage validity period by using the **expire_at** parameter. The value range is 1 to 30 days. Files are automatically deleted after the storage validity period expires. For parameter settings, see [Upload file](https://docs.byteplus.com/en/docs/ModelArk/1870405).

* Manually call the delete API to clean up inactive files: Delete uploaded files through the Files API. The following is an example.



<Tabs>
<Tab zoneid="H65CMELqHJ" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/files/file-20251014**** \
-X DELETE \
-H "Authorization: Bearer $ARK_API_KEY"
```



</Tab>
<Tab zoneid="VE7wTcZ3FW" title="Python SDK">
<TabTitle>Python SDK</TabTitle>

```Python
import os
from byteplussdkarkruntime import Ark

api_key = os.getenv('ARK_API_KEY')

client = Ark(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

if __name__ == "__main__":
    try:
        client.files.delete(
            file_id="file-20251014****"
        )
    except Exception as e:
        print(f"failed to delete response: {e}")
```



</Tab>
<Tab zoneid="Ih6H3OUkI0" title="Go SDK">
<TabTitle>Go SDK</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
)

func main() {
    client := arkruntime.NewClientWithApiKey(os.Getenv("ARK_API_KEY"),arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),)
    ctx := context.Background()

    fileInfo, err := client.DeleteFile(ctx, "file-20251114****") 
    if err != nil {
        fmt.Printf("delete file error: %v", err)
        return
    }
    fmt.Printf(" delete file: %v", fileInfo)
}
```



</Tab>
<Tab zoneid="e6N4Vsz4zl" title="Java SDK">
<TabTitle>Java SDK</TabTitle>

```Java
package com.ark.sample;

import com.byteplus.ark.runtime.model.files.DeleteFileResponse;
import com.byteplus.ark.runtime.service.ArkService;

public class demo {
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        ArkService service = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

        // delete file
        DeleteFileResponse deleteFile = service.deleteFile("file-20251117****");
        System.out.println("Delete File:" + deleteFile);

        service.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="bifJKJnVCo" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
import os
from openai import OpenAI

api_key = os.getenv('ARK_API_KEY')

client = OpenAI(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

if __name__ == "__main__":
    try:
        response = client.files.delete(
            file_id="file-20251119****"
        )
        print(response)
    except Exception as e:
        print(f"failed to delete response: {e}")
```



</Tab>
</Tabs>


<span id="8a45d4bd"></span>
# Use File ID for multimodal understanding

When files are large or need to be reused across multiple requests, we recommend uploading files through the Files API, and then using file IDs in the Responses API or Chat API for multimodal understanding. For specific examples, see [Video understanding](https://docs.byteplus.com/en/docs/ModelArk/1958521#098ef3d4), [Image understanding](https://docs.byteplus.com/en/docs/ModelArk/1958521#70e09284), [Document understanding](https://docs.byteplus.com/en/docs/ModelArk/1958521#18a762a5), and [Audio understanding](https://docs.byteplus.com/en/docs/ModelArk/2377589).

After uploading a file, you must wait until file processing is complete (that is, when **status** is active) before you can use the corresponding file ID for analysis in the Responses API or Chat API. The following is a code sample for video understanding.


<Tabs>
<Tab zoneid="WvJWg3zBql" title="cURL">
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
                       "type": "input_file",
                       "file_id": "file-20251018****"
                   },
                   {
                       "type": "input_text",
                    "text": "Describe the sequence of actions performed by the person in the video and output the results in JSON format. Include start_time, end_time, event, and danger (boolean), and express timestamps in HH:mm:ss format."
                   }
               ]
           }
       ]
   }'
   ```
   


</Tab>
<Tab zoneid="afcsCZrRxF" title="Python SDK">
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
                    "text": "Describe the sequence of actions performed by the person in the video and output the results in JSON format. Include start_time, end_time, event, and danger (boolean), and express timestamps in HH:mm:ss format."      
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
<Tab zoneid="MbGf7nKXD1" title="Go SDK">
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
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
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
                Fps: byteplus.Float64(0.3),
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
                        FileId: byteplus.String(fileInfo.ID),
                    },
                },
            },
            {
                Union: &responses.ContentItem_Text{
                    Text: &responses.ContentItemText{
                        Type: responses.ContentItemType_input_text,
                        Text: "Describe the sequence of actions performed by the person in the video and output the results in JSON format. Include start_time, end_time, event, and danger (boolean), and express timestamps in HH:mm:ss format.",
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
<Tab zoneid="mUM3uku1DD" title="Java SDK">
<TabTitle>Java SDK</TabTitle>

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
                                        .addListItem(InputContentItemText.builder().text("Describe the sequence of actions performed by the person in the video and output the results in JSON format. Include start_time, end_time, event, and danger (boolean), and express timestamps in HH:mm:ss format.").build())
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
<Tab zoneid="HDLqvyXsTH" title="OpenAI SDK">
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
                    "text": "Describe the sequence of actions performed by the person in the video and output the results in JSON format. Include start_time, end_time, event, and danger (boolean), and express timestamps in HH:mm:ss format.",
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


<span id="5a0c8d52"></span>
# Billing

File upload, file management, and other capabilities provided by the Files API do not incur fees.

Billing information for uploaded files varies by storage location as follows:


* Files stored in the default storage space managed by ModelArk: Each account has 20 GB of free storage. If this limit is exceeded, you cannot upload files. Delete files to free up storage space before uploading more files.

* Files stored in a user\-specified BytePlus TOS bucket: Fees are incurred for storage, traffic, requests, data retrieval, and other items. For detailed billing rules, see [Object hosting](https://docs.byteplus.com/en/docs/tos/Object_hosting#Mv2UN2Bn).

    &nbsp;


<span id="usage-limits-and-error-codes"></span>
# Usage limits and error codes


* The Files API QPS rate limits and bandwidth limits are as follows.

   * Upload files: 20 QPS, 100 Mbps bandwidth

   * Retrieve files: 20 QPS

   * List files: 20 QPS

   * Delete files: 20 QPS

* Error codes: Click [Error codes](https://docs.byteplus.com/en/docs/ModelArk/1299023) for more information.




