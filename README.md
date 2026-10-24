# PLATEAU Vertical Atlas（都市の垂直地図帳）

**東京の空は、何メートルからつながるのか？** ― PLATEAU × Zarrで街を水平に輪切りにしてみた

国土交通省 Project PLATEAU の3D都市モデル（CityGML）を 2m×2m×3m のボクセルに変換し、
標高ごとの水平断面で「建物がどれだけ空を占めているか（空間占有率）」と
「空き空間がどうつながっているか（連結性）」を、ブラウザ上で解析・可視化するWebアプリです。
PLATEAU LT11（2026年10月28日）での実演用プロトタイプとして作りました。

- 実データ：PLATEAU 2025年度 東京都23区 建築物（千代田区・中央区のメッシュ 53394611／53394621）、東京駅を中心とした 512m 四方の139棟
- ボクセル：Zarr v3（`occupancy[z, y, x]`、uint8、1高度＝1チャンク）を zarrita で必要な高度だけHTTP取得
- 表示：CesiumJS（建物シェルのglTF＋断面テクスチャ）、React + TypeScript、Recharts
- バックエンドなし。Cloudflare Pages / GitHub Pages にそのまま置ける静的サイト

## できること

| 機能 | 内容 |
| --- | --- |
| 水平輪切りビューア | 標高スライダー、`↑`/`↓`キー、再生ボタンで断面を上下させる。断面より上の建物は半透明・カット・そのままを切替 |
| 高度別 空間占有率 | 占有率 = 建物セル ÷ 判定可能セル（地中=255を除外）× 100。空間率、判定可能面積も表示 |
| 空間の連結性 | 空きセルの4近傍連結成分。最大連結領域の割合、成分数（100m²以上／すべて）、高度ごとの変化 |
| 建物からの離隔 | 厳密ユークリッド距離変換で「建物から d m 以上離れた空」だけを残して連結解析 |
| 境界帯の除外 | 範囲の縁を回り込むだけで生じる「見かけの連結」を確認するため、外周の帯を除外 |
| 2地点の連結判定 | 同一高度で A–B がつながるか、最短の通り道、**つながる最も低い標高** |
| 都市の地層図 | 高度別占有率を建物用途別に積み上げ |
| 空中のご近所さん | 床の標高（推定）から、同じ標高の別の建物のフロアや他の街の地面の高さと比較 |
| 山の高さをビルで体感 | 断面の高さを高尾山・筑波山・富士山の獲得標高差と比較（標高断面つき） |
| ドローン経路（実験） | 3D占有グリッド上のA*探索。**飛行計画ではありません** |
| LTデモ | `▶ LTデモ` または `?tour` で10ステップのガイド。`→`／`PageDown` で次へ |

## すぐに動かす

```bash
npm ci
npm run dev          # http://localhost:5173/
```

生成済みのデータ（`public/data/`）をリポジトリに含めているので、Pythonなしで起動できます。

| URL パラメータ | 意味 |
| --- | --- |
| `?tour` | LTデモを最初のステップから開始 |
| `?demo` | 起動時の使い方ダイアログを出さない |
| `?area=synthetic` | 合成テストデータ（検証用・実在しない街区） |
| `?z=120&mode=components` | 初期の標高（T.P. m）と表示モード（`occupancy`／`components`／`clearance`） |

キーボード：`↑`/`↓` 1段（3m）移動、`Space` 再生、`1`/`2`/`3` 表示モード、`H` 初期視点、`T` 真上、`?` 使い方、`Esc` キャンセル

## データを作り直す

```bash
python3 -m pip install -r pipeline/requirements.txt
npm run data:tokyo       # PLATEAU APIからCityGMLを取得 → ボクセル化 → public/data/tokyo-station/
npm run data:synthetic   # 合成検証データ → public/data/synthetic/
npm run data:reference   # 駅・山の標高（国土地理院 標高API）→ public/data/reference.json
```

CityGML（約420MB）と地理院タイルは `pipeline/.cache/` にキャッシュされます（git管理外）。
対象範囲は `pipeline/areas.json` で変更できます（中心経緯度・一辺・解像度・メッシュ番号）。

## テスト

```bash
npm test                         # 解析ロジックの単体テスト＋Python実装との全高度照合（vitest）
python3 -m pytest pipeline/tests # ボクセル化・解析・座標整合・実データ（pytest）
npm run build && npx vite preview --port 4173 &
npm run test:e2e                 # 実ブラウザでのE2E（Playwright）
```

## 公開

ビルド成果物 `dist/` は相対パスで構成しているため、ドメイン直下でもサブパスでも動きます。

- **Cloudflare Pages**：`npm run deploy:cloudflare`（`wrangler pages deploy dist`）。またはダッシュボードでビルドコマンド `npm run build`、出力 `dist`。`public/_headers` でデータのCORS・キャッシュを設定済み
- **GitHub Pages**：Settings → Pages → Source を「GitHub Actions」にして、Actions の「Deploy to GitHub Pages」を手動実行（リポジトリ変数 `DEPLOY_GH_PAGES=true` で main へのpushごとに自動）
- **データをR2へ移す**：`public/data/` をR2バケットに置き、`VITE_DATA_BASE_URL=https://<bucket-domain>/data/ npm run build`。R2側にCORS（GET, `*`）を設定してください

## ドキュメント

- [docs/TECHNICAL.md](docs/TECHNICAL.md) 技術仕様（座標系・ボクセル化・Zarr構成・解析アルゴリズム・採用判断）
- [docs/DEMO.md](docs/DEMO.md) 5分間LTの実演シナリオと当日のチェックリスト
- [docs/TESTING.md](docs/TESTING.md) テスト結果と既知の制約

## データ出典・ライセンス

- 3D都市モデル：国土交通省 Project PLATEAU（[G空間情報センター](https://www.geospatial.jp/ckan/dataset/plateau)、PLATEAU データカタログAPI経由）。利用規約に従い出典を表示しています
- 地表面の標高・駅や登山口の標高：国土地理院 標高タイル（DEM5A）・標高API
- 航空写真：国土地理院 地理院タイル（全国最新写真（シームレス））
- 山頂標高：国土地理院「日本の主な山岳標高」

空間の連結性・経路は建物形状だけから求めた幾何学的な解析結果です。ドローンの飛行安全性や法的な飛行可否を保証するものではありません。
階数・床の標高は計測高さと地上階数からの推定値です。

ソースコード：[MIT License](LICENSE)
