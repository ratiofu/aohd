import { Orders, isPopupOpen, markPopupAsClosed, now } from "./shared.js";

const ordersPerPage = 10;
const startWithIndex = 0;
const orderIndexLimit = 360;

let currentOrderRepository = null;

async function getOrdersRepository() {
    if (!currentOrderRepository) {
        console.log(now(), 'loading orders repository');
        currentOrderRepository = await Orders.load();
    }
    return currentOrderRepository;
}

console.log(now(), 'extension background; page size', ordersPerPage, 'limit', orderIndexLimit)

function isOnOrderPage(tab) {
    return tab?.url?.startsWith("https://www.amazon.com/your-orders/orders")
}

function isOnOrderDetailPage(tab) {
    return tab?.url?.startsWith("https://www.amazon.com/gp/css/summary/print.html")
}

// allowed page types are 'none', 'orderHistory', 'orderDetail'

async function setPageType(type) {
    console.log(now(), 'aohdCurrentPageType', type)
    await chrome.storage.local.set({aohdCurrentPageType: type});
}

async function getActiveTab() {
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    return tabs[0];
}

async function determinePageType() {
    const tab = await getActiveTab();
    console.log(now(), 'determinePageType', tab?.url)
    const pageType = isOnOrderPage(tab)
        ? 'orderHistory'
        : isOnOrderDetailPage(tab)
            ? 'orderDetail'
            : 'none';

    await setPageType(pageType)
}

chrome.tabs.onUpdated.addListener(determinePageType);
chrome.tabs.onActivated.addListener(determinePageType);
chrome.windows.onFocusChanged.addListener(determinePageType);

chrome.runtime.onMessage.addListener(async function(request) {
    const { action } = request;
    switch (action) {
        case 'downloadOrders': {
            const year = request.year;
            return startOrderRetrieval(year);
        }
        case 'parseOrderDetail': {
            determinePageType();
            const tab = await getActiveTab();
            const result = await parseOrderDetail(tab);
            console.log(now(), 'result', result);
            return
        }
        case 'obtainMissingOrderDetails': {
            console.log(now(), 'obtainMissingOrderDetails');
            return obtainMissingOrderDetails();
        }
        default:
            console.log(now(), 'unknown action', action);
            return;
    }
});

function publishUpdate() {
    isPopupOpen()
        .then(open =>
            open && chrome.runtime.sendMessage({ refreshFromStorage: true })
                .catch(error => {
                    console.warn(now(), 'error publishing update to popop', error)
                    return markPopupAsClosed()
                })
        )
}


async function startOrderRetrieval(year) {
    console.log(now(), 'startOrderRetrieval', year);
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    const currentTabId = tabs[0]?.id;
    console.log(now(), '... on tab', currentTabId);
    if (!currentTabId) return;
    let startIndex = startWithIndex;
    while (true) {
        if (startIndex >= orderIndexLimit) {
            console.log(now(), 'limit of orders reached')
            break
        }
        console.log(now(), 'navigate to next orders page for', year, startIndex);
        await navigateToNextOrdersPage(currentTabId, year, startIndex);
        const nextOrders = await executeContentFunction(currentTabId, extractOrderNumbers);
        if (nextOrders.length === 0) {
            console.log(now(), 'no more orders')
            break
        }
        await (await getOrdersRepository()).addNewOrderNumbers(year, nextOrders);
        publishUpdate();
        startIndex += ordersPerPage;
    }    
}

function waitForPageLoad(currentTabId) {
    console.log(now(), 'waitForPageLoad', currentTabId);
    return new Promise((resolve) => {
        chrome.tabs.onUpdated.addListener(
            function onTabUpdated(tabId, changeInfo) {
                if (tabId === currentTabId && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(onTabUpdated);
                    console.log(now(), 'page loaded', currentTabId, '- continuing in a moment...');
                    setTimeout(resolve, 100);
                }
            }
        );
    });
}

async function executeContentFunction(tabId, functionToExecute) {
    const results = await chrome.scripting.executeScript({ target: {tabId}, function: functionToExecute })
    const { lastError } = chrome.runtime
    if (lastError) throw new Error(lastError)
    console.log(now(), 'executeContentFunction', tabId, results)
    return results[0].result
}

async function navigateToNextOrdersPage(tabId, year, startIndex) {
    const url = `https://www.amazon.com/your-orders/orders?timeFilter=year-${year}&startIndex=${startIndex}`;
    await chrome.tabs.update(tabId, { url });
    await waitForPageLoad(tabId);
}

function extractOrderNumbers() {
    return [...document.querySelectorAll('bdi')].map(element => element.innerText);
}

async function navigateToOrderDetail(orderNumber) {
    const tab = await chrome.tabs.create({
        url: `https://www.amazon.com/gp/css/summary/print.html?ie=UTF8&orderID=${orderNumber}`,
        active: false // Open in a new background tab to avoid interrupting the user
    })
    await waitForPageLoad(tab.id);
    return tab;
}

async function obtainMissingOrderDetails() {
    const orders = await getOrdersRepository();
    while (true) {
        const orderNumber = orders.nextOrderNumberWithoutDetails();
        if (!orderNumber) {
            console.log(now(), 'no more orders without details');
            return
        }
        console.log(now(), 'obtainMissingOrderDetails', orderNumber);
        const tab = await navigateToOrderDetail(orderNumber);
        const result = await parseOrderDetail(tab, orderNumber);
        if (result.error) {
            console.error(now(), 'error parsing order detail:', result.error);
            return
        }
        await orders.saveDetail(orderNumber, result.data);
        chrome.tabs.remove(tab.id);
        publishUpdate();
    }
}

async function parseOrderDetail(tab, orderNumber) {
    console.log(now(), 'parseOrderDetail in tab ID', tab?.id);
    if (!orderNumber) {
        // parse the order number from the URL query parameter named order ID, format \d+-\d+-\d+
        const matches = tab?.url?.match(/orderID=(\d+-\d+-\d+)/);
        if (!matches) {
            console.log(now(), 'parseOrderDetail no order ID found');
            return { error: `no order ID found in URL '${tab?.url}'` };
        }
        orderNumber = matches[1];
    }
    console.warn(now(), 'parseOrderDetail for order #', orderNumber);
    return await executeContentFunction(tab.id, extractOrderDetails)
}

/**
 * Parses an Amazon order detail page for the order number, date, total, items, and transactions.
 * 
 * @returns {Promise<
 *  { error: string } |
 *  {
 *     data: {
 *       id: string,
 *       date: string,
 *       total: number,
 *       items: { item: string, price: number }[],
 *       transactions: { date: string, amount: number }[]
 *    }
 *  }
 * >}
 */
function extractOrderDetails() {

    function getElementByText(tag, text) {
        const xpath = `//${tag}[contains(., '${text}')]`;
        const elements = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        let deepestElement = null;
        let maxDepth = 0;
    
        for (let i = 0; i < elements.snapshotLength; i++) {
            let element = elements.snapshotItem(i);
            let depth = 0;
            for (let parent = element; parent !== null; parent = parent.parentNode) {
                depth++;
            }
            if (depth > maxDepth) {
                maxDepth = depth;
                deepestElement = element;
            }
        }
        return deepestElement;
    }

    function parseAmount(text) {
        return parseFloat(text?.match(/\$?(\d+\.\d+)/)?.[1] || text);
    }

    function cleanWhitespace(text) {
        return text?.replace(/[\n\s]+/g, ' ')?.trim() || null;
    }

    const orderNumber = getElementByText('b', 'Amazon.com order number')?.nextSibling?.textContent?.trim();
    console.log('orderNumber', orderNumber)
    if (!orderNumber) return ({ error: 'no order number found' });
    const orderDate = getElementByText('b', 'Order Placed:')?.nextSibling?.textContent?.trim();
    console.log('orderDate', orderDate)
    if (!orderDate) return ({ error: 'no order date found' });
    const orderTotalText = getElementByText('b', 'Order Total:')?.textContent?.trim() || '';
    const orderTotal = parseAmount(orderTotalText);
    console.log('orderTotal', orderTotal)
    if (isNaN(orderTotal)) return ({ error: 'no order total found' });
    const items = Array.from(getElementByText('table', 'Items Ordered')?.querySelectorAll('tr') || [])
        .slice(1) // Skip header row
        .map(row => {
            const itemText = cleanWhitespace(row.querySelector("td:nth-of-type(1) i")?.textContent?.trim());
            const itemPrice = parseAmount(row.querySelector("td:nth-of-type(2)")?.textContent?.trim());
            return { item: itemText, price: itemPrice };
        });
    console.log('items', items)
    if (items.length === 0) return ({ error: 'no items found' });
    
    const transactions = Array.from(getElementByText('table', 'Credit Card transactions')?.querySelectorAll('tr') || [])
        .slice(1) // assuming the first row is header or title
        .map(row => {
            const transactionText = row.textContent.trim();
            const [_, date, amount] = transactionText.split(':').map(s => s.trim());
            return { date, amount: parseAmount(amount) };
        });
    console.log('transactions', transactions)
    
    return {
        data: {
            id: orderNumber,
            date: orderDate,
            total: orderTotal,
            items: items,
            transactions: transactions
        }
    };
}
