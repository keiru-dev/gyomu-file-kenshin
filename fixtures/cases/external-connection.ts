// EXTERNAL_CONNECTION / HARDCODED_CREDENTIAL: 外部データ接続と、接続文字列内の資格情報。
//
// 類型としての問題: ブック単体では完結せず、参照先のDBやサーバが生きている前提で動く。
// さらに接続文字列にパスワードが直書きされていると、ファイルを渡した相手に資格情報ごと渡ることになる。
//
// C-4: サーバ名・DB名・利用者名・パスワードはすべて架空。実在の値を模していない。

import { buildXlsx } from "../ooxml";
import { baseSheet } from "./common";
import type { FixtureCase } from "./types";

const present: FixtureCase = {
  id: "external-connection--detected",
  ruleId: "EXTERNAL_CONNECTION",
  expectation: "detected",
  description: "外部DBへの接続定義を1件含む。xl/connections.xml が存在すること。",
  build: () =>
    buildXlsx({
      sheets: [baseSheet()],
      connections: [
        {
          name: "サンプル接続",
          connectionString: "Provider=SQLOLEDB;Data Source=dbsrv01;Initial Catalog=sample_db;Integrated Security=SSPI;",
          command: "SELECT * FROM sample_table",
        },
      ],
    }),
};

const presentClean: FixtureCase = {
  id: "external-connection--clean",
  ruleId: "EXTERNAL_CONNECTION",
  expectation: "clean",
  description: "外部データ接続を含まない。xl/connections.xml が存在しないこと。",
  build: () => buildXlsx({ sheets: [baseSheet()] }),
};

const credential: FixtureCase = {
  id: "hardcoded-credential--detected",
  ruleId: "HARDCODED_CREDENTIAL",
  expectation: "detected",
  description: "接続文字列にパスワードが直書きされている。資格情報の混入として検出されること。",
  build: () =>
    buildXlsx({
      sheets: [baseSheet()],
      connections: [
        {
          name: "サンプル接続",
          // 架空の値。実在のアカウントを模していない。
          connectionString:
            "Provider=SQLOLEDB;Data Source=dbsrv01;Initial Catalog=sample_db;User ID=sample_user;Password=DummyPass123;",
          command: "SELECT * FROM sample_table",
        },
      ],
    }),
};

const credentialClean: FixtureCase = {
  id: "hardcoded-credential--clean",
  ruleId: "HARDCODED_CREDENTIAL",
  expectation: "clean",
  description: "接続定義はあるが統合認証。パスワード直書きとしては検出されないこと。",
  build: () =>
    buildXlsx({
      sheets: [baseSheet()],
      connections: [
        {
          name: "サンプル接続",
          connectionString: "Provider=SQLOLEDB;Data Source=dbsrv01;Initial Catalog=sample_db;Integrated Security=SSPI;",
        },
      ],
    }),
};

export const externalConnectionCases: FixtureCase[] = [
  present,
  presentClean,
  credential,
  credentialClean,
];
