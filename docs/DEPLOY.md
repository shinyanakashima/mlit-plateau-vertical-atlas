# 公開手順

`npm run build` で作られる `dist/`（約55MB・約1,900ファイル、最大ファイル約5MB）を静的ホスティングに置くだけです。
パスはすべて相対なので、ドメイン直下でもサブディレクトリでも動きます。サーバー側の処理は不要です。

リポジトリは private のため、GitHub Pages は有料プランが必要です。次の A か B を使ってください。

## A. Cloudflare Pages（推奨）

### A-1. Git連携（pushごとに自動デプロイ）

1. Cloudflare ダッシュボード → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. GitHub を認可し、`shinyanakashima/mlit-plateau-vertical-atlas` を選択（private でも可）
3. ビルド設定

   | 項目 | 値 |
   | --- | --- |
   | Production branch | `main` |
   | Framework preset | None（または Vite） |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | 環境変数 | `NODE_VERSION` = `22` |

4. **Save and Deploy**。完了すると `https://<project>.pages.dev/` で公開されます
5. 確認：`https://<project>.pages.dev/?tour` でLTデモが始まり、右上の「Zarr」が 82/82 になること

`public/_headers` により、`/data/*` にCORSとキャッシュ、`/assets/*` に長期キャッシュが付きます。

### A-2. 手元から直接アップロード（Git連携なし）

```bash
npx wrangler login                                   # ブラウザでCloudflareにログイン（初回のみ）
npx wrangler pages project create plateau-vertical-atlas --production-branch main   # 初回のみ
npm run deploy:cloudflare                            # build → wrangler pages deploy dist
```

CIから実行する場合は、`CLOUDFLARE_API_TOKEN`（権限：Cloudflare Pages: Edit）と `CLOUDFLARE_ACCOUNT_ID` を環境変数に設定します。

## B. ConoHa WING（private リポジトリの静的公開の代替）

1. 手元で `npm ci && npm run build`
2. `dist/` の**中身**（`index.html`, `assets/`, `cesium/`, `data/`, `.htaccess`, `404.html` など）を、
   ファイルマネージャーまたはFTPで公開ディレクトリ（例：`public_html/<ドメイン>/vertical-atlas/`）にアップロード
   - `.htaccess` は隠しファイルなので、FTPクライアントで隠しファイル表示を有効にしてから転送
   - 拡張子のない Zarr チャンク（`data/*/atlas.zarr/**/c/0/0/0` など）も漏れなく転送すること（約1,900ファイル）
3. 確認：`https://<ドメイン>/vertical-atlas/?tour`

`public/.htaccess` で、データのCORS・キャッシュ、`.glb` のMIMEタイプ、404ページを設定しています。

## C. GitHub Pages（リポジトリを public にする、または有料プランの場合）

1. Settings → Pages → Source を **GitHub Actions** にする
2. Actions → **Deploy to GitHub Pages** → **Run workflow**
3. `main` へのpushごとに自動公開したい場合は、Settings → Secrets and variables → Actions → Variables に `DEPLOY_GH_PAGES` = `true`

## 大きなデータをR2に分ける場合（任意）

エリアを増やしてデータが大きくなったときは、`public/data/` をR2バケットに置き、データの参照先だけを差し替えます。

```bash
# 例：R2の公開ドメインが https://atlas-data.example.com の場合
VITE_DATA_BASE_URL=https://atlas-data.example.com/data/ npm run build
```

R2バケットのCORSポリシーで、公開先のオリジンからの `GET` を許可してください。

## 公開後のチェック

- [ ] トップページが表示され、「PLATEAU実データ」バッジが出る
- [ ] 右上の「Zarr」が全高度（東京駅 82、西新宿 90）まで進む
- [ ] `?tour` で `→` を押すとステップが進む
- [ ] ブラウザの開発者ツールで `/data/` 配下に 404 がない
- [ ] 手元から `E2E_URL=https://<公開URL>/ npm run test:e2e` がすべて成功する
