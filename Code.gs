const CONFIG = {
  SPREADSHEET_ID:'1ExQIwFKiSXnYScZnWik5Q7JlBIYDjEMUqHmmDoZB0Fo',
  CALENDAR_ID: 'bddef955fc6879de50a2a3bacccfc98579ba8b7313e0b4d6682f67ec44ac28ad@group.calendar.google.com',
  TIME_ZONE: 'Asia/Tokyo',
  NOTIFY_EMAIL: 'hai.tomotask@gmail.com',
  ERROR_EMAIL: 'hai.tomotask@gmail.com'
};

/** メインHTML出力 */
function doGet() {
  // HTMLファイル（index）を読み込んでWebページとして出力準備をします
  const htmlOutput = HtmlService.createHtmlOutputFromFile('index')
    // ブラウザのタブに表示されるタイトルを設定
    .setTitle('PAIX予約ページ')
    
    // モバイル端末での表示設定
    // width=device-width：端末の画面幅に合わせる
    // initial-scale=1：初期表示を等倍に設定
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);  // iframeでの表示を許可
    // 設定を適用したWebページを返す
  return htmlOutput;
}

/** Googleスプレッドシートを取得 */
function getSheetByName(sheetName) {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(sheetName);
}

/** Googleカレンダーを取得 */
function getCalendar() {
  return CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
}

/** メニュー情報をカテゴリごとに取得 */

function getMenuDataByCategory() {
  try {
    const sheet = getSheetByName('料金表');
    const data = sheet.getDataRange().getValues();
    const categories = {
      '脱毛メニュー': [],
      '各パーツ脱毛メニュー': [],
      'ホワイトニング': []
    };

    // データ処理
    data.slice(1).forEach(([name, price, duration, category]) => {
      if (categories[category]) {
        categories[category].push({
          name: name || '未定義メニュー',
          price: parseInt(price, 10) || 0,
          duration: parseInt(duration, 10) || 0,
          category
        });
      }
    });

    return categories;
  } catch (error) {
    handleError('getMenuDataByCategory', error);
    return {};
  }
}


/** 予約作成 */
function createReservation(selectedCourses, selectedDateTime, customerName, phone, email) {
  try {
    const calendar = getCalendar();
    const totalDuration = selectedCourses.reduce((sum, course) => sum + course.duration, 0);
    const startTime = new Date(selectedDateTime);
    const endTime = new Date(startTime.getTime() + totalDuration * 60 * 1000);

    // Google カレンダーにイベントを作成
    calendar.createEvent(`${customerName} ${phone}`, startTime, endTime, {
      description: `コース: ${selectedCourses.map(course => course.name).join(', ')}\nメール: ${email || 'なし'}`,
    });

    // 月ごとのシートに予約履歴を追加
    const sheet = getOrCreateMonthlySheet(startTime);
    sheet.appendRow([
      Utilities.formatDate(startTime, CONFIG.TIME_ZONE, 'yyyy/MM/dd HH:mm'),
      `${formatTime(startTime)} - ${formatTime(endTime)}`,
      selectedCourses.map(course => course.name).join(', '),
      customerName,
      phone,
      email
    ]);

    sendNotificationEmail(customerName, phone, email, selectedCourses, selectedDateTime);
  } catch (error) {
    handleError('createReservation', error);
  }
}

/** 月ごとのシートを取得または作成 */
function getOrCreateMonthlySheet(date) {
  const sheetName = Utilities.formatDate(date, CONFIG.TIME_ZONE, 'yyyy-MM'); // シート名は「2024-01」など
  const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
    sheet.appendRow(['予約日時', '時間帯', 'コース', 'お名前', '電話番号', 'メールアドレス']); // ヘッダー行

    // 列の幅を設定
    sheet.setColumnWidths(1, 6, 150);

    // ヘッダーを太字にする
    const headerRange = sheet.getRange('A1:F1');
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#f2f2f2');
  }

  return sheet;
}

/** 空き時間スロットを取得 */
function fetchAvailableTimeSlots(selectedDate, totalDuration) {
  try {
    const calendar = getCalendar();
    const now = new Date();
    const cutoffTime = new Date(now.getTime() + 60 * 60 * 1000);

    const dayStart = new Date(`${selectedDate}T09:00:00`);
    const dayEnd = new Date(`${selectedDate}T21:00:00`);
    const events = calendar.getEvents(dayStart, dayEnd);

    const blockedTimes = events.map(event => ({ start: event.getStartTime(), end: event.getEndTime() }));

    let slotTime = new Date(dayStart);
    const availableSlots = [];

    while (slotTime < dayEnd) {
      const slotEndTime = new Date(slotTime.getTime() + totalDuration * 60 * 1000);

      if (slotTime <= cutoffTime || slotEndTime > dayEnd) {
        slotTime.setMinutes(slotTime.getMinutes() + 30);
        continue;
      }

      const isAvailable = !blockedTimes.some(blocked =>
        slotTime < blocked.end && slotEndTime > blocked.start
      );

      if (isAvailable) {
        availableSlots.push(formatDateTime(slotTime));
      }

      slotTime.setMinutes(slotTime.getMinutes() + 30);
    }

    return availableSlots;
  } catch (error) {
    handleError('fetchAvailableTimeSlots', error);
  }
}

/** 通知メール送信 */
function sendNotificationEmail(customerName, phone, email, selectedCourses, selectedDateTime) {
  const subject = '新しい予約が入りました';
  const body = `
    新しい予約がありました:\n
    お名前: ${customerName}\n
    電話番号: ${phone}\n
    メールアドレス: ${email || '未入力'}\n
    予約日時: ${selectedDateTime}\n
    コース:\n${selectedCourses.map(course => `  - ${course.name}`).join('\n')}
  `;
  GmailApp.sendEmail(CONFIG.NOTIFY_EMAIL, subject, body);
}

/** エラー通知メール送信 */
function handleError(functionName, error) {
  const subject = 'システムエラー通知';
  const body = `
    以下の関数でエラーが発生しました:\n
    関数名: ${functionName}\n
    エラーメッセージ: ${error.message}\n
    スタックトレース: ${error.stack}
  `;
  GmailApp.sendEmail(CONFIG.ERROR_EMAIL, subject, body);
  throw error;
}

/** ユーティリティ関数 */
function formatDateTime(date) {
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, 'yyyy/MM/dd HH:mm');
}

function formatTime(date) {
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, 'HH:mm');
}
