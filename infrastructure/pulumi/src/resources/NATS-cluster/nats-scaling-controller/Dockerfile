ARG AWS_LAMBDA_NODE_JS_IMAGE_REFERENCE=public.ecr.aws/lambda/nodejs:24

FROM ${AWS_LAMBDA_NODE_JS_IMAGE_REFERENCE}

COPY package.json ./
RUN npm install
COPY controller.ts index.ts ./
RUN npx tsc index.ts controller.ts --target es2022 --module nodenext --types node --rewriteRelativeImportExtensions --skipLibCheck --outDir dist && cp dist/*.js . && npm prune --omit=dev
CMD ["index.handler"]
