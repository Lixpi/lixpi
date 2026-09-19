FROM public.ecr.aws/lambda/nodejs:24

COPY package.json ./
RUN npm install
COPY controller.ts index.ts ./
RUN npx tsc index.ts controller.ts --target es2022 --module nodenext --rewriteRelativeImportExtensions --skipLibCheck --outDir dist && cp dist/*.js . && npm prune --omit=dev
CMD ["index.handler"]
