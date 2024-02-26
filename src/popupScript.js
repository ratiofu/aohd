import { markPopupAsClosed, markPopupAsOpen, now, Orders } from "./shared.js";

let yearSelect = null;
let getOrdersNumbersButton = null;
let parseOrderDetailButton = null;
let orderPageInstructions = null;

/** @type Orders | null */
let ordersRepository = null;

function disableYearSelection() {
    if (yearSelect) {
        yearSelect.style.display = 'none';
        yearSelect.options.length = 0;
    }
    if (getOrdersNumbersButton) {
        getOrdersNumbersButton.style.display = 'none';
    }
    if (orderPageInstructions) {
        orderPageInstructions.style.display = 'block';
    }
}

function enableYearSelection() {
    if (orderPageInstructions) {
        orderPageInstructions.style.display = 'none';
    }
    if (!yearSelect || !getOrdersNumbersButton) return;
    yearSelect.style.display = 'inline-block';
    getOrdersNumbersButton.style.display = 'inline-block';
    const currentYear = new Date().getFullYear();
    for (let year = currentYear; year > currentYear - 5; year--) {
        const option = document.createElement('option');
        option.value = option.text = year;
        yearSelect?.add(option);
    }
}

function disableParseOrderDetail() {
    parseOrderDetailButton && (parseOrderDetailButton.style.display = 'none');
}

function enableParseOrderDetail() {
    parseOrderDetailButton && (parseOrderDetailButton.style.display = 'block');
}

function getOrdersForYear(year) {
    console.log('getOrdersForYear', year);
    chrome.runtime.sendMessage({ action: "downloadOrders", year });
}

function shareKnownOrdersInClipboard() {
    if (ordersRepository === null) return
    const share = ordersRepository.asTsv()
    navigator.clipboard.writeText(share)
}

const formatDollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format

async function listKnownOrders() {
    ordersRepository = await Orders.load()
    const orderList = document.getElementById('knownOrdersList')
    if (orderList) {
        // orderList.innerText = JSON.stringify(knownOrders, null, 2)
        // for each year key in the knownOrders object, render a list of order numbers
        clearAllDomElements(orderList)
        const { ordersByYear } = ordersRepository
        for (const year in ordersByYear) {
            const yearHeader = document.createElement('h3')
            yearHeader.innerText = year
            orderList.appendChild(yearHeader)
            const yearList = document.createElement('ol')
            ordersByYear[year].forEach(orderNumber => {
                const orderItem = document.createElement('li')
                // for each item, render a link to order invoice details page that opens in a new tab
                const orderLink = document.createElement('a')
                orderLink.href = `https://www.amazon.com/gp/css/summary/print.html?ie=UTF8&orderID=${orderNumber}`
                orderLink.target = '_blank'
                // format the order number itself inside the link as `code`
                const orderText = document.createElement('code')
                orderText.innerText = orderNumber
                
                orderLink.appendChild(orderText)
                orderItem.appendChild(orderLink)
                debugger
                const orderDetail = ordersRepository.orderDetailFor(orderNumber)
                if (orderDetail) {
                    const label = document.createElement('span')
                    label.innerText = ` ✅ ${orderDetail.date} - `
                    const amount = document.createElement('strong')
                    amount.innerText = formatDollars(orderDetail.total) || '?'
                    label.appendChild(amount)
                    orderItem.appendChild(document.createElement('br'))
                    orderItem.appendChild(label)
                }

                yearList.appendChild(orderItem)
            })
            orderList.appendChild(yearList)
        }
    }
}

function clearAllDomElements(element) {
    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }
}

async function updatePageState() {
    console.log(now(), 'updating page state')
    const { aohdCurrentPageType } = await chrome.storage.local.get('aohdCurrentPageType')
    switch (aohdCurrentPageType) {
        case 'orderHistory':
            enableYearSelection()
            disableParseOrderDetail()
            break;
        case 'orderDetail':
            disableYearSelection()
            enableParseOrderDetail()
            break;
        default:
            disableYearSelection()
            disableParseOrderDetail()
            break;
    }

    await listKnownOrders()
}

document.addEventListener('DOMContentLoaded', async function() {

    window.addEventListener('unload', markPopupAsClosed)

    yearSelect = document.getElementById('yearSelect');
    getOrdersNumbersButton = document.getElementById('getOrderNumbersButton');
    parseOrderDetailButton = document.getElementById('parseOrderDetailButton');
    orderPageInstructions = document.getElementById('orderPageInstructions');

    if (getOrdersNumbersButton)
        getOrdersNumbersButton.addEventListener('click', function() {
            const selectedYear = Number(yearSelect?.value) || 0;
            if (selectedYear > 0) getOrdersForYear(selectedYear);
        });

    if (parseOrderDetailButton)
        parseOrderDetailButton.addEventListener('click', function() {
            chrome.runtime.sendMessage({ action: "parseOrderDetail" });
        });

    document.getElementById('copyOrdersToClipboard')
        ?.addEventListener('click', shareKnownOrdersInClipboard)

    document.getElementById('obtainMissingOrderDetails')
        ?.addEventListener('click', () => chrome.runtime.sendMessage({ action: "obtainMissingOrderDetails" }))

    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        if (request.refreshFromStorage) {
            console.log('refreshing page from storage');
            updatePageState();
        }
    })

    await updatePageState();

    await markPopupAsOpen();

});
