FROM public.ecr.aws/lambda/nodejs:24

# Copy package.json
COPY package.json ./

# Install dependencies (use npm for simplicity in Lambda containers)
RUN npm install --omit=dev
RUN npm install typescript

# Copy TypeScript configuration
COPY tsconfig.json ./

# Copy ONLY the Lambda function source code (not the Pulumi infrastructure file)
COPY index.ts ./

# Compile TypeScript
RUN npx tsc

# Copy the compiled JavaScript from dist to the Lambda task root
RUN cp dist/index.js ./index.js

# Set the CMD to your handler (could also be done as a parameter override outside of the Dockerfile)
CMD [ "index.handler" ]
