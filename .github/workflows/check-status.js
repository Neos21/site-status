const fs    = require('fs');
const http  = require('http');
const https = require('https');


// 定数
// ====================================================================================================

/** サイト定義 */
const sites = [
  { name: "Neo's World", https: 'neos21.net'   , http: 'neo.s21.xrea.com', statusJsonPath: '/status.json' },
  { name: "Neo's World", https: 'neos21.tk'    , http: 'neo.s21.xrea.com', statusJsonPath: '/status.json' },
  { name: 'GCE'        , https: 'neos21-gce.ga', http: '35.197.103.64'   , statusJsonPath: '/status.json' },
  { name: 'OCI 1'      , https: 'neos21-oci.cf', http: '140.238.56.203'  , statusJsonPath: '/status.json' },
  { name: 'OCI 2'      , https: 'neos21-oci.ml', http: '158.101.130.242' , statusJsonPath: '/status.json' }
];

/** 通知を行う有効期限日までの残日数 */
const expireDaysToNotify = {
  domain: 30,
  cert  : 10
};


// 関数
// ====================================================================================================

/**
 * リクエストする
 * 
 * @param {string} url URL
 * @param {object} options オプション
 * @return {Promise<object>} JSON パースしたレスポンス
 */
function request(url, options) {
  return new Promise((resolve, reject) => {
    options = options || {};
    console.log(`Request : [${url}]`, options);
    const agent = url.startsWith('https:') ? https : http;
    const body = options.body || null;
    if(options.body) delete options.body;
    
    const req = agent.request(url, options, (res) => {
      let data = '';
      res.setEncoding('utf8')
        .on('data', (chunk) => {
          data += chunk;
        })
        .on('end', () => {
          try {
            console.log('Request : Success', data);
            resolve(data);
          }
          catch(error) {
            console.error('Request : Failed To JSON Parse', error, data);
            reject(error);
          }
        });
    })
      .on('error', (error) => {
        console.error('Request : An Error Occurred', error);
        reject(error);
      })
      .on('timeout', () => {
        console.error('Request : Timeout');
        req.abort();
        reject('Request Timeout');
      })
      .setTimeout(5000);
    
    if(body) req.write(body);
    req.end();
  });
}

/**
 * 1サイトのステータスを取得する
 * 
 * @param {object} site https と http プロパティで URL 文字列を持つ連想配列
 * @return {object} ヘルス・メッセージ・ステータスを持つ連想配列
 */
async function fetchInfo(site) {
  try {
    const rawHttpsStatus = await request(`https://${site.https}${site.statusJsonPath}`);
    let httpsStatus = JSON.parse(rawHttpsStatus);
    // Neo's World は現状2つドメインがあるので区別する
    if(Array.isArray(httpsStatus)) {
      httpsStatus = httpsStatus.find((status) => status.domain_name === site.https);
    }
    console.log('Fetch Status : Success With HTTPS (OK)', httpsStatus);
    return {
      site   : site,
      health : 'OK',
      message: 'HTTPS Is Alive',
      status : httpsStatus
    };
  }
  catch(error) {
    console.warn('Fetch Status : Failed To Fetch With HTTPS. Continue With HTTP', error);
  }
  
  try {
    const rawHttpStatus = await request(`http://${site.http}${site.statusJsonPath}`);
    let httpStatus = JSON.parse(rawHttpStatus);
    // Neo's World は現状2つドメインがあるので区別する
    if(Array.isArray(httpStatus)) {
      httpStatus = httpStatus.find((status) => status.domain_name === site.https);
    }
    console.log('Fetch Status : Success With HTTP (Warning)', httpStatus);
    return {
      site   : site,
      health : 'Warning',
      message: 'HTTPS May Be Down',
      status : httpStatus
    };
  }
  catch(error) {
    console.error('Fetch Status : Failed To Fetch With HTTP. Site May Be Down (Error)', error);
    return {
      site   : site,
      health : 'Error',
      message: 'Site May Be Down',
      status : {
        domain_registration_date: 'UNKNOWN',
        domain_expiry_date      : 'UNKNOWN',
        cert_renew_date         : 'UNKNOWN',
        cert_expiry_date        : 'UNKNOWN'
      }
    };
  }
}

/**
 * 日付データを作る
 * 
 * @param {string | undefined} dateString 'YYYY-MM-DD' 形式の文字列・今日日付を取得したい場合は引数を渡さない
 * @return {Date} 0時0分0秒の日付
 */
function createDate(dateString) {
  const date = dateString ? new Date(dateString) : new Date();
  date.setHours(0);
  date.setMinutes(0);
  date.setSeconds(0, 0);
  return date;
}

/**
 * ドメイン・証明書の残日数を取得し、通知の要否を算出する
 * 
 * @param {Date} today 今日日付
 * @param {object} status 各サイトから取得した status.json の連想配列
 * @return {object} ドメイン・証明書の残日数と通知要否を表した連想配列
 */
function diffDate(today, status) {
  const diff = {
    domainDaysLeft    : '-',
    domainShouldNotify: false,
    certDaysLeft      : '-',
    certShouldNotify  : false
  };
  
  if(status.domain_expiry_date && status.domain_expiry_date !== 'UNKNOWN') {
    const domain = createDate(status.domain_expiry_date);
    diff.domainDaysLeft     = Math.floor((domain - today) / 86400000);
    diff.domainShouldNotify = (diff.domainDaysLeft <= expireDaysToNotify.domain);
  }
  
  // XREA の無料 SSL は有効期限がないので '-' が設定されている
  if(status.cert_expiry_date && status.cert_expiry_date !== 'UNKNOWN' && status.cert_expiry_date !== '-') {
    const cert = createDate(status.cert_expiry_date);
    diff.certDaysLeft     = Math.floor((cert - today) / 86400000);
    diff.certShouldNotify = (diff.certDaysLeft <= expireDaysToNotify.cert);
  }
  
  return diff;
}

/**
 * 日付オブジェクトを 'YYYY-MM-DD' 形式に変換する
 * 
 * @param {Date} date Date オブジェクト
 * @return {string} 'YYYY-MM-DD' 形式の文字列
 */
function formatDate(date) {
  return date.getFullYear()
    + '-' + ('0' + (date.getMonth() + 1)).slice(-2)
    + '-' + ('0' + date.getDate()).slice(-2);
}

/**
 * README.md を組み立てる
 * 
 * @param {string} todayString 'YYYY-MM-DD' 形式の今日日付
 * @param {object} infos 各サイトの情報
 * @return {string} README.md の内容
 */
function createReadmeText(todayString, infos) {
  const emoji = {
    'OK'     : '✅',
    'Warning': '⚠️',
    'Error'  : '❌'
  };
  
  const readmeText = `# Site Status\n\n\n## Last Updated : ${todayString}\n`
    + '\n' + infos.reduce((line, info) => line + ` ${info.site.name} |`, '| Name |')
    + '\n' + infos.reduce((line,_info) => line + '---|'                , '|------|')
    + '\n' + infos.reduce((line, info) => line + ` [${info.site.http}](http://${info.site.http}/)`                          + ' |', '| Global IP                |')
    + '\n' + infos.reduce((line, info) => line + ` [${info.site.https}](http://${info.site.https}/)`                        + ' |', '| Domain                   |')
    + '\n' + infos.reduce((line, info) => line + ` ${emoji[info.health]} ${info.health}`                                    + ' |', '| Health                   |')
    + '\n' + infos.reduce((line, info) => line + ` ${info.message}`                                                         + ' |', '| Message                  |')
    + '\n' + infos.reduce((line, info) => line + ` ${info.status.domain_registration_date}`                                 + ' |', '| Domain Registration Date |')
    + '\n' + infos.reduce((line, info) => line + ` ${info.status.domain_expiry_date}`                                       + ' |', '| Domain Expiry Date       |')
    + '\n' + infos.reduce((line, info) => line + ` ${info.diff.domainShouldNotify ? '⚠️ ' : ''}${info.diff.domainDaysLeft}` + ' |', '| Domain Days Left         |')
    + '\n' + infos.reduce((line, info) => line + ` ${info.status.cert_renew_date}`                                          + ' |', '| Cert Renew Date          |')
    + '\n' + infos.reduce((line, info) => line + ` ${info.status.cert_expiry_date}`                                         + ' |', '| Cert Expiry Date         |')
    + '\n' + infos.reduce((line, info) => line + ` ${info.diff.certShouldNotify ? '⚠️ ' : ''}${info.diff.certDaysLeft}`     + ' |', '| Cert Days Left           |')
    + `


## Links

- [Neo's World](https://neos21.net/)
- [GitHub - Neos21](https://github.com/Neos21/)
- [GitHub - site-status](https://github.com/Neos21/site-status)
- [GitHub Pages - Site Status](https://neos21.github.io/site-status/)
`;
  
  console.log('Readme Text : \n', readmeText);
  return readmeText;
}

/**
 * README.md にテキストを上書き保存する
 * 
 * @param {string} readmeText README.md の内容
 * @return {Promise<boolean>} 保存できれば true を返す
 */
function updateReadme(readmeText) {
  return fs.promises.writeFile('./README.md', readmeText, 'utf-8')
    .then(() => {
      console.log('Update Readme : Success');
      return true;
    })
    .catch((error) => {
      console.log('Update Readme : Failed', error);
      return Promise.reject(error);
    });
}

/**
 * Slack 通知用のメッセージを組み立てる
 * 
 * @param {string} todayString 'YYYY-MM-DD' 形式の今日日付
 * @param {object} infos 各サイトの情報
 * @return {string} Slack 通知用のメッセージ (特に知らせることがなければ空文字)
 */
function createMessageForSlack(todayString, infos) {
  let message = '';
  infos.forEach((info) => {
    let siteMessage = '';
    if(info.health !== 'OK') {
      siteMessage += `• ヘルス : ${info.health} (${info.message})\n`;
    }
    if(info.diff.domainShouldNotify) {
      siteMessage += `• ドメイン有効期限 : あと ${info.diff.domainDaysLeft} 日\n`;
    }
    if(info.diff.certShouldNotify) {
      siteMessage += `• SSL 有効期限 : あと ${info.diff.certDaysLeft} 日\n`;
    }
    
    if(siteMessage) {
      message += `\n*${info.site.name}*\n${siteMessage}`;
    }
  });
  
  // 末尾の不要な改行コードを除去しつつ返す
  if(message) {
    message = `*${todayString} : サイトのステータスに異常があります。*\n${message.replace((/\n$/u), '')}`;
  }
  return message;
}

/**
 * Slack に通知する
 * 
 * @param {string} message 投稿メッセージ
 * @return {Promise<boolean>} リクエストが成功すれば true を返す
 */
function notifyToSlack(message) {
  return request(process.env.SLACK_URL, {
    headers: {
      'Content-Type': 'application/json; charset=UTF-8'
    },
    method: 'POST',
    body: JSON.stringify({ text: message })
  })
    .then((result) => {
      console.log('Notify To Slack : Success', result);
      return true;
    })
    .catch((error) => {
      console.warn('Notify To Slack : Failed To Request. Continue', error);
      return error;
    });
}

// メイン処理
(async () => {
  const today = createDate();  // NOTE : 引数に 'YYYY-MM-DD' 形式の日付を指定することで未来日付でのテストが可能
  const todayString = formatDate(today);
  console.log('Today : ', today, todayString);
  
  const rawInfos = await Promise.all(sites.map((site) => fetchInfo(site)));
  const infos = rawInfos.map((info) => {
    info.diff = diffDate(today, info.status);
    return info;
  });
  console.log('Infos : ', infos);
  
  const readmeText = createReadmeText(todayString, infos);
  await updateReadme(readmeText);  // エラー時はココで中断する
  
  if(process.env.SLACK_URL) {
    const message = createMessageForSlack(todayString, infos);
    if(message) {
      await notifyToSlack(message);
    }
    else {
      console.log('Nothing To Notify To Slack');
    }
  }
  else {
    console.log('Environment Variable SLACK_URL is empty. Skip Notify To Slack');
  }
  
  console.log('Finished');
})();
