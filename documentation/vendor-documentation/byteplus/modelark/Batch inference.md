When your tasks are computationally intensive but do not require immediate results — such as large\-scale data processing, daily news summarization, long\-text translation, or user feedback analysis — you can use batch inference to submit asynchronous requests. Batch inference provides higher quotas (at least 10B tokens per day) and lower unit pricing (50% off or more).

In addition, batch inference enables more flexible task scheduling, allowing you to maintain high processing throughput even during peak periods.

This topic explains how to implement batch inference tasks using APIs. If you prefer to perform tasks in the console, see [Batch inference (via console)](https://docs.byteplus.com/en/docs/ModelArk/1305505).

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">This topic doesn't cover batch video generation. For more information on batch video generation, see the <strong>Offline Inference</strong> section in <a href="https://docs.byteplus.com/en/docs/ModelArk/1366799#offline-inference">Video Generation</a>.</div>


<span id="1cbb9a13"></span>
# Supported models

See available models in the [Console](https://console.byteplus.com/ark/region:ark+ap-southeast-1/batchInference/create).

> Please submit [a ticket](https://console.byteplus.com/workorder/create) to check the availability of models that are not listed in the console.


<span id="5662bf05"></span>
# Select a request method

ModelArk provides you with two ways to invoke the batch inference service. You can select the appropriate method according to your business needs.


<span aceTableMode="list" aceTableWidth="1,3,3"></span>
|Method |Batch Jobs (create batch inference tasks) |Batch Chat (calling batch inference endpoints) |
|---|---|---|
|Way of working |Use a `JSONL` file to store a large number of requests to be processed and upload it to TOS (object storage). Create a batch task with [CreateBatchInferenceJob](https://docs.byteplus.com/en/docs/ModelArk/1339603). After all requests are completed, the results are written back to TOS.<br><br>Supports console operations. You can also access [batch inference](https://console.byteplus.com/ark/region:ark+ap-southeast-1/endpoint?config=%7B%7D). |Send processing tasks to the model through the API. After a period of time (depending on load and resource availability), the ModelArk platform directly returns the processing results. |
|Application scenarios |* Data is already stored in object storage, HDFS, or ES on BytePlus or other cloud vendors.<br><br>* The data volume is large, with more than 100B tokens processed per day.<br><br>* Multimodal batch inference places high pressure on internet bandwidth. |* Data is not stored statically in object storage, and the organization and transformation of data is complex.<br><br>* The upstream and downstream components of the model call are online links.<br><br>* One component in the end\-to\-end service pipeline is expensive to transform on its own. |
|Core process |1. Upload data or upload it in shards to object storage.<br><br>2. Create a batch inference task.<br><br>3. Query batch inference task status.<br><br>4. Read inference results from object storage |1. Create batch inference endpoints.<br><br>2. Run batch inference by using the Batch Chat API.<br><br>3. Configure the timeout (greater than 30 minutes) and concurrency based on business requirements. |
|Advantages<br><br>Disadvantages |* Supports larger\-scale data processing or stricter internet\-bandwidth constraints.<br><br>* Hosted resource scheduling for all requests supports flexible task scheduling and helps achieve optimal throughput.<br><br>   Requires additional engineering work, such as data upload, sharding, and directory management. |* With a low retrofit cost, your project can switch to batch inference with only small adjustments based on the online inference interface.<br><br>* Flexible task scheduling helps maintain processing efficiency even during peak periods.<br><br>* You may receive more `ServerOverloaded` errors during peak periods.<br><br>* Daily throughput depends on platform resource limits and user concurrency control, so it is slightly less predictable than Batch Jobs. |


<span id="6586959b"></span>
# Quota description


* Batch inference quota TPD calculation logic:

   * Under the same account, usage is aggregated by model name (for example, all versions of `skylark-pro-***`).

   * Quotas are not shared with the rate\-limited quotas of online inference.

   For example, under your main account, the Skylark\-pro model has 3 batch inference tasks, a, b, and c, and 2 online inference tasks, d and e. Tasks a, b, and c share the batch inference quota of 10B tokens per day, while d and e share the TPM and RPM quotas for online inference.

* ModelArk's quota policy for batch inference is designed to ensure fairness among users and prevent abuse or misuse from causing platform overload or service interruption. If your business needs to process more data every day, please submit [a ticket](https://console.byteplus.com/workorder/create) to apply.

* You can submit tasks that exceed your quota, and when the ModelArk platform has free resources, your quota will be dynamically expanded.

* The time calculation window of TPD is a 24\-hour sliding window. A short\-term high concurrency request affects the quota of the subsequent 24 hours. Compared with the fixed window, you should pay attention to the uniformity of the request distribution.

* Account quota: by default, each model has a quota of 10B tokens/day. You can apply for a quota increase through [a ticket](https://console.byteplus.com/workorder/create).


<span id="075b8a07"></span>
# Batch chat tutorial

If you want to migrate your business from online inference to batch inference at a very low cost, you can use Batch Chat for batch inference.

> For the detailed description of the interface fields, see [Batch inference (Chat)](https://docs.byteplus.com/en/docs/ModelArk/1528783).


<span id="49f91cdc"></span>
## Prerequisites


* You have [obtained the API Key](https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey?apikey=%7B%7D).

> * If you use Access Key authentication, see [Access key](https://docs.byteplus.com/en/docs/ModelArk/1298459#21bff83b).

> * For more secure use of API Key/Access Key, we recommend that you [Configure API Key to environment variables](https://docs.byteplus.com/en/docs/ModelArk/1399008#4b62407d).

* You have [created a batch inference endpoint](https://docs.byteplus.com/en/docs/ModelArk/1305505#d581da34).

* You have installed or upgraded to the latest SDK for ModelArk. See [Install the Python SDK](https://docs.byteplus.com/en/docs/ModelArk/1541595) for details.


<span id="20fdc5ac"></span>
## Quick start

You can use the minimal sample code to quickly initiate a batch inference request.

You can use the Batch Chat API and replace `<MODEL>` with your endpoint ID. For more information, see [Batch inference using the Batch Inference endpoint SDK](https://docs.byteplus.com/en/docs/ModelArk/1305505#363a0966).

```Python
import os
from byteplussdkarkruntime import Ark
# Read your ModelArk API Key from the environment variable
client = Ark(
    api_key=os.environ.get("ARK_API_KEY"),
    # 1-hour timeout
    timeout=3600,
)
# Use the batch_chat.completions interface
completion = client.batch_chat.completions.create(
    # Replace <MODEL> with the batch inference endpoint ID
    model="<MODEL>",
    messages=[
        {"role": "user", "content": "Hello"}
    ]
)
print(completion.choices[0].message.content)
```


<span id="41b49ce6"></span>
## Instructions

After creating the batch inference endpoint, you can call the batch inference service through the SDK of Python, GO, Java and other languages. If you want to take full advantage of the high throughput of batch inference, pay attention to core configurations such as **timeout times** and **concurrency policies** . Here are some suggestions.

> View the full range of languages [sample code](https://docs.byteplus.com/en/docs/ModelArk/1399517#01826852).


<span id="3b8e1a6f"></span>
### Increase task request completion rate

To improve the task completion rate and avoid timeouts when many requests are queued under high server load, we recommend manually configuring a long timeout period (from 1 hour to 72 hours). **Recommended configuration: 24 hours to 72 hours.**  **You do not need to manually configure a retry policy.**  ModelArk will intelligently schedule tasks to improve completion rates.

> The timeout corresponds to the `timeout` field, which specifies the timeout period for a single request. A longer timeout does not affect quotas. If you set a short timeout in scenarios that require a long response time, the task may time out midway, waste tokens, and fail to return the full output.

> The ModelArk client automatically retries requests within the configured timeout window, or waits and retries as instructed by the ModelArk service. On the service side, a request may be temporarily queued and retried according to current load conditions.


```Python
...
client = AsyncArk(
    api_key=os.environ.get("ARK_API_KEY"),
    # Use the asynchronous interface and configure a long timeout period. The recommended range is 24 to 72 hours.
    timeout=3600 * 24,
)
...
```


<span id="a0b61aa1"></span>
### Configure Concurrency Policy to Fully Utilize Quota

ModelArk provides a quota of at least 10B tokens/day for each master account, and you can submit a large number of tasks to the ModelArk platform by requesting the configuration of concurrency and replica number. The ModelArk platform will intelligently schedule and execute tasks for you based on business load, and even provide you with processing power beyond the base quota when the load is low.

> The concurrent\-request parameter `workerNum` represents the maximum number of concurrent requests sent to the ModelArk service. It determines the maximum number of requests your business can send at one time.


After creating the client and before sending requests to the ModelArk service, you need to start the relevant client\-side threads.

> For the Java client, no additional threads need to be started manually because it already includes a thread pool. The exact method varies by programming language. For details, refer to the [sample code](https://docs.byteplus.com/en/docs/ModelArk/1399517#01826852).


When configuring `workerNum`, consider factors such as expected peak traffic, average latency, and the upper limit of machine concurrency. The following example shows how to estimate the number of concurrent requests and replicas.

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">The expected maximum peak QPS of the service is 5000, and the average latency of a single request is 5 seconds, deployed on 2C4G machines or containers.</div>


<div data-tips="true" data-tips-type="tip"><strong>Key metrics</strong></div>



* <div data-tips="true" data-tips-type="tip">Business concurrency: <code>5000 * 5 = 25000</code></div>


* <div data-tips="true" data-tips-type="tip">Server limit: Without accounting for business\-layer overhead, the maximum server load is between 1000 and 1500 QPS. In this example, we assume 1000 QPS.</div>



<div data-tips="true" data-tips-type="tip"><strong>Number of replicas and concurrency configuration</strong></div>


<div data-tips="true" data-tips-type="tip">If you need to handle peak traffic, you can deploy more replicas (recommended) or upgrade server specifications (not recommended):</div>



* <div data-tips="true" data-tips-type="tip">Number of replicas (estimated number of servers): <code>Business QPS / server limit = 5000 / 1000 = 5</code>.</div>


* <div data-tips="true" data-tips-type="tip">Number of concurrent requests <code>workerNum</code> (set on each replica): <code>server limit * average request latency = 1000 * 5 = 5000</code>.</div>



<span id="1bb954de"></span>
### Other instructions and suggestions

> For example, the `StartBatchWorker` method in the Go SDK client creates `workerNum` goroutines. This helps avoid the overhead caused by repeatedly creating a large number of goroutines.


<span id="01826852"></span>
## Sample code


<Tabs>
<Tab zoneid="mW0siLh4zM" title="Python asynchronous implementation (recommended)">
<TabTitle>Python asynchronous implementation (recommended)</TabTitle>

Compared to the multithreaded approach, the asynchronous coroutine approach is better:


* **Higher concurrency**: When a task is in an I/O waiting state (such as a network request), `asyncio` can immediately switch to other tasks to continue execution, avoiding thread\-switching overhead and improving overall concurrency performance.

* **More lightweight**: Coroutines are lightweight execution units that consume fewer system resources than threads, so you can create a large number of coroutines to handle tasks.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">tip</div>


<div data-tips="true" data-tips-type="tip">Batch inference is a standard high\-IO/low\-computing scenario. For scenarios where your system is not using synchronous API adaptation, it is recommended to use the asynchronous version. For most scenarios, asynchronous coroutines can achieve better results.</div>


```Python
# Import libraries related to asynchronous programming for handling asynchronous tasks. Coroutines are a core concept in asynchronous programming.
import asyncio
# Import system-related libraries, which can be used to interact with the Python interpreter and the system, such as standard error output.
import sys
# Import operating system-related libraries for accessing the functions of the operating system, such as reading environment variables.
import os
# Import the date and time processing library for recording and calculating the execution time of the program.
from datetime import datetime
# Import the asynchronous ModelArk client library for communicating with the ModelArk service.
from byteplussdkarkruntime import AsyncArk

async def worker(
    # The unique identifier of the asyncio task coroutine, used to distinguish different worker coroutines.
    worker_id: int,
    # The asynchronous ModelArk client instance, used to call the batch chat completion interface to handle requests.
    client: AsyncArk,
    # The queue of requests to be processed, storing the requests that need to be handled.
    requests: asyncio.Queue[dict],
):
    """
    An asynchronous coroutine function responsible for getting requests from the queue and processing them.

    :param worker_id: The unique identifier of the coroutine, used to distinguish different coroutines in the logs.
    :param client: The asynchronous ModelArk client instance, through which the service interface is called to process requests.
    :param requests: The queue of requests to be processed, storing the information of the requests to be processed.
    """
    # Print the startup information of the coroutine.
    print(f"Worker {worker_id} is starting.")
    while True:
        # Get a request from the queue. If the queue is empty, it will block and wait.
        # The await keyword here is used to pause the execution of the coroutine and wait for an element to be available in the queue.
        request = await requests.get()
        try:
            # Call the batch chat completion interface of the client to process the request, using the unpacking operation to pass the request dictionary as a parameter.
            # Also use the await keyword to pause the coroutine and wait for the interface call to complete.
            completion = await client.batch_chat.completions.create(**request)
            # Print the processing result.
            print(completion)
        except Exception as e:
            # If an exception occurs during the processing of the request, print the error message to the standard error output.
            print(e, file=sys.stderr)
        finally:
            # Mark that the request has been processed and notify the queue that the task is completed.
            requests.task_done()

async def main():
    """
    The main function is responsible for initializing the client, generating requests, starting coroutines, and monitoring the completion of tasks.

    Coroutines are used to achieve concurrent processing of requests, avoiding the relatively large overhead brought by using threads.
    Multiple coroutines can execute concurrently in a single thread, improving the performance of the program.
    """
    # Record the start time of the program execution.
    start = datetime.now()
    # Define the number of coroutines and the number of tasks.
    worker_num, task_num = 1000, 10000
    # Create an asynchronous queue for storing requests, which supports asynchronous operations.
    requests = asyncio.Queue()
    # Initialize the asynchronous ModelArk client.
    client = AsyncArk(
        # Get the API key from the environment variable to ensure the security of the key.
        api_key=os.environ.get("ARK_API_KEY"),
        # Set the timeout to 24 hours. It is recommended to set the timeout as large as possible, preferably 24 hours to 72 hours, to avoid request timeouts due to network or other reasons.
        timeout=24 * 3600,
    )
    # Simulate `task_num` tasks and add the request information to the queue.
    for _ in range(task_num):
        await requests.put(
            {
                # Replace it with your batch inference endpoint ID, specifying the service endpoint to be called.
                "model": "<YOUR_ENDPOINT_ID>",
                "messages": [
                    {
                        # The system role message is used to set the initial information of the conversation.
                        "role": "system",
                        "content": "You are Skylark, an AI assistant developed by ByteDance.",
                    },
                    {
                        # The user role message contains the specific question of the user.
                        "role": "user",
                        "content": "What are the common cruciferous plants?"
                    }
                ]
            }
        )
    # Create `worker_num` asyncio task coroutines and start them. Each coroutine is responsible for processing the requests in the queue.
    # These coroutines will execute concurrently in a single thread, and the efficiency is improved through the switching of coroutines.
    tasks = [
        asyncio.create_task(worker(i, client, requests))
        for i in range(worker_num)
    ]
    # Wait for all requests to be processed, that is, all tasks in the queue are marked as completed.
    await requests.join()
    # Stop all coroutines and cancel all running tasks.
    for task in tasks:
        task.cancel()
    # Wait for all coroutines to be cancelled, ensuring that all tasks have been stopped.
    await asyncio.gather(*tasks, return_exceptions=True)
    # Close the client connection and release resources.
    await client.close()
    # Record the end time of the program execution.
    end = datetime.now()
    # Print the total execution time of the program and the total number of tasks processed.
    print(f"Total time: {end - start}, Total task: {task_num}")

if __name__ == "__main__":
    # Run the asynchronous main function to start the entire program.
    # asyncio.run() will create an event loop and run the main coroutine in this event loop.
    asyncio.run(main())
```



</Tab>
<Tab zoneid="QBH1xHFvI0" title="Python multithreaded implementation">
<TabTitle>Python multithreaded implementation</TabTitle>

The batch inference endpoint invocation method is similar to the online inference endpoint. Pay attention to the following additional configurations.


1. Set the `timeout`.

2. The number of concurrent threads for the configuration and the number of tasks running in the threads.

3. Use the `client.batch_chat.completions` method.


```Python
# Import the queue module to create queues
import queue
# Import the sys module to provide access to some variables used or maintained by the Python interpreter
import sys
# Import the datetime class from the datetime module for handling dates and times
from datetime import datetime
# Import the ThreadPool class from the multiprocessing.pool module to create a thread pool
from multiprocessing.pool import ThreadPool
# Import the ModelArk Runtime SDK
from byteplussdkarkruntime import Ark

def worker(
    # The unique identifier of the thread
    worker_id: int,
    # The ModelArk client instance
    client: Ark,
    # The queue of requests to be processed
    requests: queue.Queue[dict],
):
    """
    The thread function is responsible for getting requests from the queue and processing them.

    :param worker_id: The unique identifier of the thread
    :param client: The ModelArk client instance
    :param requests: The queue of requests to be processed
    """
    print(f"Worker {worker_id} is starting.")
    while True:
        # Get a request from the queue
        request = requests.get()

        # Check if the signal of no more requests is received
        if not request:
            # Put the signal back into the queue so that other threads can also receive it
            requests.put(request)
            return
        try:
            # Execute the request
            completion = client.batch_chat.completions.create(**request)
            print(completion)
        except Exception as e:
            # Print the error message to the standard error output
            print(e, file=sys.stderr)
        finally:
            # Mark that the request has been processed
            requests.task_done()

def main():
    """
    The main function is responsible for initializing the client, generating requests, starting threads, and monitoring the completion of tasks.
    """
    # Record the start time
    start = datetime.now()
    # The maximum number of concurrent tasks and the total number of tasks
    worker_num, task_num = 1000, 10000
    # Create a queue to store requests
    requests = queue.Queue()
    # Initialize the ModelArk client and set the timeout to 24 hours
    client = Ark(
        # Get the API key from the environment variable
        api_key=os.environ.get("ARK_API_KEY"),
        # Set the timeout to 24 hours. It is recommended to set the timeout as large as possible, preferably between 24 hours and 72 hours.
        timeout=24 * 3600,
    )
    # Simulate `task_num` tasks
    for _ in range(task_num):
        requests.put(
            {
                # Replace it with your batch inference endpoint ID
                "model": "<YOUR_ENDPOINT_ID>",
                "messages": [
                    {
                        "role": "system",
                        "content": "You are Skylark, an AI assistant developed by ByteDance.",
                    },
                    {"role": "user", "content": "What are the common cruciferous plants?"},
                ],
            }
        )
    # Put in a signal indicating the end of requests
    requests.put(None)

    # Create `worker_num` threads and start them
    with ThreadPool(worker_num) as pool:
        for i in range(worker_num):
            # Execute the thread function asynchronously
            pool.apply_async(worker, args=(i, client, requests))

        # Close the thread pool and no longer accept new tasks
        pool.close()
        # Wait for all tasks to be completed
        pool.join()
    # Close the client connection
    client.close()
    # Record the end time
    end = datetime.now()
    print(f"Total time: {end - start}, Total task: {task_num}")

if __name__ == "__main__":
    # Run the main function
    main()
```



</Tab>
<Tab zoneid="V6Rkn28hx1" title="Go">
<TabTitle>Go</TabTitle>

The batch inference endpoint invocation method is similar to the online inference endpoint.

You need to upgrade the latest SDK and pay attention to the changes in the sample code below.


1. Set the `timeout`.

2. Call the `client.StartBatchWorker()` method.

3. Use the `client.CreateBatchChatCompletion` method.


```Go
package main

import (
    "context"
    "encoding/json"
    "fmt"
    "os"
    "sync"
    "time"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    // Set the timeout to 24 hours. It is recommended to set the timeout as large as possible, preferably between 24 hours and 72 hours.
    timeout := time.Hour * 24

    // Create a new client instance using the API key and set the timeout.
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        arkruntime.WithTimeout(timeout),
    )
    // Set the maximum number of concurrent requests to 3000 and start the background loop.
    client.StartBatchWorker(3000)
    wg := sync.WaitGroup{}
    // Initiate 50,000 requests.
    for i := 0; i < 50000; i++ {
        wg.Add(1)
        // Initiate the request asynchronously.
        go func(index int) {
            defer wg.Done()
            // Initiate a batch inference request.
            result, err := client.CreateBatchChatCompletion(context.Background(), model.ChatCompletionRequest{
                Model: os.Getenv("YOUR_ENDPOINT_ID"),
                Messages: []*model.ChatCompletionMessage{
                    {
                        Role: model.ChatMessageRoleSystem,
                        Content: &model.ChatCompletionMessageContent{
                            StringValue: byteplus.String("You are Skylark, an AI assistant developed by ByteDance."),
                        },
                    },
                    {
                        Role: model.ChatMessageRoleUser,
                        Content: &model.ChatCompletionMessageContent{
                            StringValue: byteplus.String("What are the common cruciferous plants?"),
                        },
                    },
                },
            })
            if err != nil {
                fmt.Fprintln(os.Stderr, index, err)
            } else {
                fmt.Println(index, MustMarshalJson(result))
            }
        }(i)
    }
    // Wait for all goroutines to complete their tasks.
    wg.Wait()
}

func MustMarshalJson(v interface{}) string {
    s, _ := json.Marshal(v)
    return string(s)
}
```



</Tab>
<Tab zoneid="w66tlrqHZf" title="Java">
<TabTitle>Java</TabTitle>

The batch inference endpoint invocation method is similar to the online inference endpoint.

You need to upgrade the latest SDK and pay attention to the changes in the sample code below.


1. Set the `timeout`.

2. Set the maximum number of threads and the number of tasks per thread.

> Java SDK comes with a thread pool, so there is no need for a batch thread start method.


3. Use the `ChatCompletionRequest` class to start batch inference.


```Java
package com.example;

import com.byteplus.ark.runtime.model.completion.chat.ChatCompletionRequest;
import com.byteplus.ark.runtime.model.completion.chat.ChatMessage;
import com.byteplus.ark.runtime.model.completion.chat.ChatMessageRole;
import com.byteplus.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public class BatchChatCompletionsExample {
    public static void main(String[] args) {
        // Set a relatively long timeout for batch chat. It is recommended to set it between 24 hours and 72 hours.
        Duration timeout = Duration.ofHours(24);
        // You need to configure the maximum number of threads and the number of tasks executed by each thread according to your own needs.
        int workerNum = 10000;
        int taskNum = 5;
        // You need to set your own API key as an environment variable.
        String apikey = System.getenv("ARK_API_KEY");
        ConnectionPool connectionPool = new ConnectionPool(workerNum, 10, TimeUnit.MINUTES);
        Dispatcher dispatcher = new Dispatcher();
        dispatcher.setMaxRequests(workerNum);
        dispatcher.setMaxRequestsPerHost(workerNum);
        // Please initialize a separate service instance for batch chat, and do not reuse the same service instance among multiple Endpoints to avoid mutual interference.
        // A single service will start the corresponding thread pool according to the maximum concurrency, which will occupy a certain amount of resources.
        ArkService service = ArkService.builder().dispatcher(dispatcher).timeout(timeout).connectionPool(connectionPool)
               .apiKey(apikey)
               .build();
        ExecutorService executorService = Executors.newFixedThreadPool(workerNum);
        CountDownLatch latch = new CountDownLatch(workerNum);
        Runnable batchChatTask = () -> {
            System.out.println(Thread.currentThread().getName() + ": Execute tasks in this thread");
            for (int i = 0; i < taskNum; i++) {
                // The task logic executed by each thread needs to be modified according to your own business requirements. Here, as an example, a simplest conversation example is shown.
                try {
                    final List<ChatMessage> messages = new ArrayList<>();
                    final ChatMessage systemMessage = ChatMessage.builder().role(ChatMessageRole.SYSTEM)
                           .content("You are Skylark, an AI assistant developed by ByteDance.").build();
                    final ChatMessage userMessage = ChatMessage.builder().role(ChatMessageRole.USER)
                           .content("Hello").build();
                    messages.add(systemMessage);
                    messages.add(userMessage);

                    ChatCompletionRequest batchChatCompletionRequest = ChatCompletionRequest.builder()
                            // You need to replace it with your batch inference endpoint ID.
                           .model("<YOUR_ENDPOINT_ID>")
                           .messages(messages)
                           .build();
                    service.createBatchChatCompletion(batchChatCompletionRequest)
                           .getChoices()
                           .forEach(choice -> System.out.println(Thread.currentThread().getName() + ":"
                                    + choice.getMessage().getContent()));
                } catch (Exception e) {
                    System.out.println(Thread.currentThread().getName() + ": Request " + i + " failed.");
                    System.out.println("    Error message: " + e.getMessage());
                }
            }
            System.out.println(Thread.currentThread().getName() + ": Tasks in this thread are completed.");
            latch.countDown();
        };
        for (int i = 0; i < workerNum; i++) {
            executorService.submit(batchChatTask);
        }
        try {
            latch.await();
        } catch (InterruptedException ignored) {
        }
        System.out.println("All threads have exited");
        executorService.shutdown();
        System.out.println("The thread pool has exited");
        // When all requests are completed, please shut down the service.
        service.shutdownExecutor();
    }
}
```



</Tab>
</Tabs>


<span id="d6f60e44"></span>
# Batch job development tutorial

To create batch inference tasks through the console, see [Create batch inference tasks](https://docs.byteplus.com/en/docs/ModelArk/1305505).

<span id="c2779ba5"></span>
## Prerequisites


* You have [enabled the specified model service](https://console.byteplus.com/ark/region:ark+ap-southeast-1/openManagement?LLM=%7B%7D&OpenTokenDrawer=false).

* You have [enabled TOS](https://console.byteplus.com/tos/) (object storage) and have [created a bucket](https://console.byteplus.com/tos/bucket?projectName=default).

* Install the [TOS SDK](https://docs.byteplus.com/en/docs/tos/Install-the-python-sdk) and the [BytePlus SDK](https://docs.byteplus.com/en/docs/ModelArk/1319854).

* You have [obtained an Access Key](https://console.byteplus.com/iam/keymanage).


<span id="bf2ab0f6"></span>
## Quick start

You can create, query, and download results for batch inference tasks using the Quick Start sample code.

<span id="aaf211b6"></span>
### Prepare batch inference task files

Refer to [Input/output format](https://docs.byteplus.com/en/docs/ModelArk/1305505) and prepare a data file in `jsonl` format, where each line contains the details of one API request.

In each line of the input file, the `body` field uses the same parameters as the corresponding interfaces, and each request must contain a unique `custom_id` value. Later, you can use `custom_id` to locate the result for the corresponding request. The following example shows an input file with two requests.

> We provide a script to verify whether the file is valid and help avoid download failures caused by formatting errors. See [Input](https://docs.byteplus.com/en/docs/ModelArk/1305505) for details.


```JSON
{"custom_id": "request-1", "body": {"messages": [{"role": "user", "content": "Why is the sky so blue?"}],"max_tokens": 1000,"top_p":1}}
{"custom_id": "request-2", "body": {"messages": [{"role": "system", "content": "You are an unhelpful assistant."},{"role": "user", "content": "Why is the sky so blue?"}],"max_tokens": 1000}}
```


Please note:


* Each input file can contain only requests for a single model.


<span id="e077fc63"></span>
### Upload task files to TOS

You need to upload the task file to the TOS bucket, and the subsequent ModelArk platform will read the request information in the file for batch inference. Here is a simple script to upload a file.

If your task file is large, you can refer to the [tutorial](https://docs.byteplus.com/en/docs/tos/Shard-upload-python-sdk) to upload it in shards.

> Before running the script, fill in your task information, such as bucket configuration, and store your Access Key credentials in the environment variables `BYTEPLUS_ACCESS_KEY` and `BYTEPLUS_SECRET_KEY` (refer to [Configure API Key to environment variables](https://docs.byteplus.com/en/docs/ModelArk/1399008#4b62407d) for instructions).


```Python
import os
import tos

# Read your Access Key from the environment variable. For security reasons, it is recommended that you configure the Access Key in the environment variable.
ak = os.environ.get("BYTEPLUS_ACCESS_KEY")
sk = os.environ.get("BYTEPLUS_SECRET_KEY")
# Attributes of the bucket storing task files and result files, including the ENDPOINT and the region.
endpoint = "tos-ap-southeast-1.bytepluses.com"
region = "ap-southeast-1"
bucket_name = "input-bucket"
# The file path of the task file to be uploaded.
object_key = "input/data.jsonl"
# The local path of the task file.
file_name = "/usr/local/data.jsonl"
# Initialize the TOS client.
client = tos.TosClientV2(ak, sk, endpoint, region)
# Upload the file.
client.put_object_from_file(bucket_name, object_key, file_name)
```


<span id="56139293"></span>
### Create a batch inference task

You can call the [CreateBatchInferenceJob](https://docs.byteplus.com/en/docs/ModelArk/1339603) interface to configure and create batch inference tasks, including the input file path, output path, and model to use.

> Before running the script, fill in your task information in the `Config` class and store your Access Key credentials in the environment variables `BYTEPLUS_ACCESS_KEY` and `BYTEPLUS_SECRET_KEY` (see [Configure API Key to environment variables](https://docs.byteplus.com/en/docs/ModelArk/1399008#4b62407d) for instructions).


```Python
import byteplussdkcore
import byteplussdkark
import os

# Configuration class, you need to change it to your own configuration.
class Config:
    # Attributes of the bucket storing task files and result files, including the ENDPOINT and the region.
    REGION = "ap-southeast-1"
    INPUT_BUCKET = "input-bucket"
    # The file path of the task file to be uploaded.
    INPUT_OBJECT_KEY = "input/data.jsonl"
    OUTPUT_BUCKET = "output-bucket"
    # The folder for storing the result file.
    OUTPUT_OBJECT_KEY = "output/"
    # The local path of the task file.
    LOCAL_FILE_NAME = "/usr/local/data.jsonl"
    # The model version and name. You can query it here: https://docs.byteplus.com/en/docs/ModelArk/1330310
    MODEL_VERSION = "250115"
    MODEL_NAME = "Skylark-***"
    # Name your batch inference task.
    JOB_NAME = "demo"
    # The name of the project where the batch inference task is located. The default is "default".
    PROJECT_NAME = "default"
    # Read your Access Key from the environment variable. For security reasons, it is recommended that you configure the Access Key in the environment variable.
    AK = os.environ.get("BYTEPLUS_ACCESS_KEY")
    SK = os.environ.get("BYTEPLUS_SECRET_KEY")

# Create a batch inference task.
def create_batch_job(ark_instance):
    input_file_tos_location = (
        byteplussdkark.InputFileTosLocationForCreateBatchInferenceJobInput(
            bucket_name=Config.INPUT_BUCKET,
            object_key=Config.INPUT_OBJECT_KEY
        )
    )
    output_dir_tos_location = (
        byteplussdkark.OutputDirTosLocationForCreateBatchInferenceJobInput(
            bucket_name=Config.OUTPUT_BUCKET,
            object_key=Config.OUTPUT_OBJECT_KEY
        )
    )
    foundation_model = byteplussdkark.FoundationModelForCreateBatchInferenceJobInput(
        model_version=Config.MODEL_VERSION,
        name=Config.MODEL_NAME
    )
    model_reference = byteplussdkark.ModelReferenceForCreateBatchInferenceJobInput(
        foundation_model=foundation_model
    )
    req = byteplussdkark.CreateBatchInferenceJobRequest(
        input_file_tos_location=input_file_tos_location,
        model_reference=model_reference,
        name=Config.JOB_NAME,
        output_dir_tos_location=output_dir_tos_location,
        project_name=Config.PROJECT_NAME,
    )
    resp = ark_instance.create_batch_inference_job(req)
    return resp.id

configuration = byteplussdkcore.Configuration()
configuration.ak = Config.AK
configuration.sk = Config.SK
configuration.region = Config.REGION
configuration.client_side_validation = True
byteplussdkcore.Configuration.set_default(configuration)
ark_instance = byteplussdkark.ARKApi(byteplussdkcore.ApiClient(configuration))
# Create a batch inference task.
batch_job_id = create_batch_job(ark_instance)
print(f"Batch inference task created, task ID: {batch_job_id}")
```


Returns the ID of the created batch inference task.

```JSON
Batch inference task created, task ID: bi-20250305220634-****
```


<span id="f3bc73c8"></span>
### Query batch inference task status

You can check the task status at any time, including filtering by task ID, model, and running status. See [ListBatchInferenceJobs](https://docs.byteplus.com/en/docs/ModelArk/1339606) for the available filters.

```Python
import os
import byteplussdkcore
import byteplussdkark

class Config:
    # Attributes of the bucket storing task files and result files, including the ENDPOINT and the region.
    REGION = "ap-southeast-1"
    # Read your Access Key from the environment variable. For security reasons, it is recommended that you configure the Access Key in the environment variable.
    AK = os.environ.get("BYTEPLUS_ACCESS_KEY")
    SK = os.environ.get("BYTEPLUS_SECRET_KEY")
    # Replace it with the ID of the batch inference task you created.
    BATCH_JOB_ID = "bi-2025030****"

# List the information of the batch inference task with the specified ID.
def list_batch_inference_jobs(ark_instance, batch_job_id):
    filter = byteplussdkark.FilterForListBatchInferenceJobsInput(ids=[batch_job_id])
    req = byteplussdkark.ListBatchInferenceJobsRequest(filter=filter)
    resp = ark_instance.list_batch_inference_jobs(req)
    return resp


configuration = byteplussdkcore.Configuration()
configuration.ak = Config.AK
configuration.sk = Config.SK
configuration.region = Config.REGION
configuration.client_side_validation = True
byteplussdkcore.Configuration.set_default(configuration)
ark_instance = byteplussdkark.ARKApi(byteplussdkcore.ApiClient(configuration))
batch_job_status = list_batch_inference_jobs(ark_instance, Config.BATCH_JOB_ID)
print(f"Batch inference task information:\n{batch_job_status}")
```


Run the script to get back information about the tasks that match the filter criteria.

```JSON
Batch inference task information:
{'items': [{'completion_window': '28 days',
            'create_time': '2025-03-05T14:06:34Z',
            'description': '',
            'expire_time': '2025-04-02T14:06:34Z',
            'id': 'bi-20250305220634-****',
            'input_file_tos_location': {'bucket_name': 'input-bucket',
                                        'object_key': 'input/data.jsonl'},
           'model_reference': {'custom_model_id': None,
                                'foundation_model': {'model_version': '250115',
                                                     'name': 'Skylark-***'}},
            'name': 'demo',
            'output_dir_tos_location': {'bucket_name': 'output-bucket',
                                        'object_key': 'output/'},
            'project_name': 'default',
           'request_counts': {'completed': 2, 'failed': 0, 'total': 2},
           'status': {'message': '',
                       'phase': 'Completed',
                       'phase_time': '2025-03-05T15:07:47Z'},
            'tags': [{'key':'sys:ark:createdBy',
                      'value': '****'}],
            'update_time': '2025-03-05T15:07:47Z'}],
 'page_number': 1,
 'page_size': 10,
 'total_count': 1}
```


The batch inference task states are as follows:


|Status |Description |
|---|---|
|Queued |Task submitted successfully, queuing for execution |
|Running |Task in progress |
|Completed |Task completed. |
|Terminating |The task is being stopped. |
|Terminated |The task has been stopped. |
|Failed |Task execution failed, possibly due to timeout or other reasons. |


<span id="8a64682f"></span>
### Download batch inference task results

After the batch inference task is completed, you can download the result files through the interface. The task produces two files:


* Results.jsonl: A collection of results from successful execution of a batch inference task. The order of the results may not match the task file, so use `custom_id` to identify the corresponding request.

* Errors.jsonl: A collection of bad requests after a batch inference task is executed.


```Python
import os
import tos

# Replace it with your batch inference task ID
batch_job_id = "bi-20250305220634-****"
# Read your Access Key from the environment variable. For security reasons, it is recommended that you configure the Access Key in the environment variable.
ak = os.environ.get("BYTEPLUS_ACCESS_KEY")
sk = os.environ.get("BYTEPLUS_SECRET_KEY")
# Replace it with the attributes of your bucket, including endpoint, region, and bucket_name
endpoint = "tos-ap-southeast-1.bytepluses.com"
region = "ap-southeast-1"
bucket_name = "output-bucket"
# Replace it with the path of the result file of the batch inference task you configured
output_object_key = "output/"
# Replace it with the local path where you store the result file of the batch inference task
local_output_dir = "./output"

results_key = f"{output_object_key}{batch_job_id}/output/results.jsonl"
errors_key = f"{output_object_key}{batch_job_id}/output/errors.jsonl"
results_file_name = f"{local_output_dir}{batch_job_id}/results.jsonl"
errors_file_name = f"{local_output_dir}{batch_job_id}/errors.jsonl"
client = tos.TosClientV2(ak, sk, endpoint, region)
try:
    client.get_object_to_file(bucket_name, results_key, results_file_name)
except:
    print("results.jsonl does not exist or there is another error")
try:
    client.get_object_to_file(bucket_name, errors_key, errors_file_name)
except:
    print("errors.jsonl does not exist or there is another error")
```


You can find the batch inference task result files under the configured `local_output_dir` path.

```JSON
{"id":"02174118435223600000000000000000000ffffac1520039ca4e1","custom_id":"request-1","error":null,"response":{"request_id":"02174118435223600000000000000000000ffffac1520039ca4e1","status_code":200,"body":{"id":"02174118435223600000000000000000000ffffac1520039ca4e1","object":"chat.completion","created":1741184547,"model":"Skylark-***","choices":[{"index":0,"message":{"role":"assistant","content":"The sky appears blue mainly due to the Rayleigh scattering phenomenon. Here is a detailed explanation for you:\n\n### Composition of sunlight\nSunlight is actually composed of a variety of different colored lights. These lights, in order of wavelength from long to short, are red, orange, yellow, green, blue, indigo, and violet, which is what we often call the seven-color light.\n\n### Composition of the atmosphere\nThe Earth's atmosphere is mainly composed of nitrogen, oxygen, and other trace gas molecules and tiny particles. When sunlight enters the atmosphere, it will interact with these gas molecules.\n\n### Rayleigh scattering process\nAccording to the Rayleigh scattering law, the intensity of scattered light is inversely proportional to the fourth power of the wavelength of light. That is to say, the shorter the wavelength of light, the easier it is to be scattered.\n\nAmong the various colored lights contained in sunlight, the wavelength of blue light is relatively short (about 450 - 495 nanometers). When sunlight enters the Earth's atmosphere, blue light is easily scattered in all directions by gas molecules in the atmosphere. So, when we look up at the sky, this blue light scattered in all directions will enter our eyes, making us feel that the entire sky is blue.\n\n### Factors affecting the shade of the blue sky\nAt different times and places, the content of water vapor, dust, and other particulate matter in the atmosphere is different, which will to a certain extent change the effect of the atmosphere on the scattering of blue light. When there are more particulate matters in the air, more blue light is scattered and absorbed, and the sky may appear light blue or even a bit white; while in areas with purer air, such as by the sea or on plateaus, the scattering effect is more obvious, and the sky will look bluer."},"finish_reason":"stop"}],"usage":{"prompt_tokens":13,"completion_tokens":322,"total_tokens":335,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":0}},"HttpHeader":{"X-Request-Id":["02174118435223600000000000000000000ffffac1520039ca4e1"],"X-Client-Request-Id":["2025030522191200000CA2C7FE1C9A9065"],"Vary":["Accept-Encoding"],"Server":["hertz"],"Date":["Wed, 05 Mar 2025 14:22:26 GMT"],"Content-Type":["application/json; charset=utf-8"]}}}}
{"id":"02174118707871600000000000000000000ffffac152003cadb62","custom_id":"request-2","error":null,"response":{"request_id":"02174118707871600000000000000000000ffffac152003cadb62","status_code":200,"body":{"id":"02174118707871600000000000000000000ffffac152003cadb62","object":"chat.completion","created":1741187249,"model":"Skylark-***","choices":[{"index":0,"message":{"role":"assistant","content":"I don't want to explain this problem to you properly. What does it matter to me whether the sky is blue or not? You figure it out yourself."},"finish_reason":"stop"}],"usage":{"prompt_tokens":25,"completion_tokens":24,"total_tokens":49,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":0}},"HttpHeader":{"X-Client-Request-Id":["202503052304380000BACD2ADACB18921B"],"Vary":["Accept-Encoding"],"Server":["hertz"],"Date":["Wed, 05 Mar 2025 15:07:29 GMT"],"Content-Type":["application/json; charset=utf-8"],"X-Request-Id":["02174118707871600000000000000000000ffffac152003cadb62"]}}}}
```


<span id="75240726"></span>
## Instructions

<span id="93b00236"></span>
### Increase the limit

If you have a lot of business processing tasks, you can apply for a quota increase as needed.


* Account quota: by default, each model has a quota of 10B tokens/day. You can apply for a quota increase through [a ticket](https://console.byteplus.com/workorder/create).

* Account\-level concurrent tasks: by default, there is a limit on how many tasks can run at the same time. You can apply for a quota increase [here](https://console.byteplus.com/quota/productList).

* Single task file size: the default is 5GiB . If necessary, you can apply for an increase through [a ticket](https://console.byteplus.com/workorder/create).


<span id="b92e248b"></span>
## Related documents


* [CreateBatchInferenceJob](https://docs.byteplus.com/en/docs/ModelArk/1339603): View the interface used to create batch inference tasks and the meaning of each field.

* [Batch inference (via console)](https://docs.byteplus.com/en/docs/ModelArk/1305505): How to use the console to manage batch inference tasks.




