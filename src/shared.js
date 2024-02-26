console.log('hello from shared.js')

let start = Date.now()
let lastCallAt = start

export const now = () => {
    const now = Date.now()
    const diff = now - lastCallAt
    lastCallAt = now
    return `[ ${((now - start) / 1_000).toFixed(2)}s +${diff}ms ]`
}

/*

We're storing the following locally:

ordersByYear: a hash object of years, each with an array of order numbers
orderDetails: a hash object of order numbers, each with an object of order details

an order detail has the following properties:
{
    id: string,
    date: string,
    total: number,
    items: { item: string, price: number }[],
    transactions: { date: string, amount: number }[]
}

*/

async function loadOrdersByYear() {
    const { ordersByYear = {} } = await chrome.storage.local.get({ordersByYear: {}})
    return ordersByYear
}

async function loadOrderDetails() {
    const { orderDetails = {} } = await chrome.storage.local.get({orderDetails: {}})
    return orderDetails
}

function formatDateToYYYYMMDD(date) {
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`
  }

export class Orders {

    constructor(ordersByYear = {}, orderDetails = {}) {
        this._ordersByYear = ordersByYear
        this._orderDetails = orderDetails
    }

    get ordersByYear() {
        return this._ordersByYear
    }

    orderDetailFor(orderNumber) {
        return this._orderDetails[orderNumber]
    }

    nextOrderNumberWithoutDetails() {
        const allOrderNumbers = Object
            .keys(this._ordersByYear)
            .reduce((orderNumbers, year) => [...orderNumbers, ...this._ordersByYear[year]], [])
        return allOrderNumbers.find(orderNumber => !this._orderDetails[orderNumber])
    }

    asTsv() {
        console.log(now(), 'generating tab-delimited export')

        // loops over all order details and within each detail over each item and for each item over each transaction
        // and returns a string with all the columns denormalized, separated by tabs, using these headers
        const lines = []
        let orderCount = 0
        for (const orderNumber in this._orderDetails) {
            orderCount++
            const orderDetail = this._orderDetails[orderNumber]
            let itemCount = 0
            for (const item of orderDetail.items) {
                itemCount++
                const { transactions } = orderDetail
                const itemLine = [
                    orderCount,
                    formatDateToYYYYMMDD(new Date(orderDetail.date)),
                    orderDetail.total,
                    orderNumber,
                    `https://www.amazon.com/gp/your-account/order-details?ie=UTF8&orderID=${orderNumber}`,
                    itemCount,
                    item.item,
                    item.price,
                ]
                if (!transactions || transactions.length === 0) {
                    lines.push([ ...itemLine, 'Other', '', '' ])
                } else {
                    for (const transaction of orderDetail.transactions) {
                        lines.push([
                            ...itemLine,
                            'CC Charge',
                            formatDateToYYYYMMDD(new Date(transaction.date)),
                            transaction.amount
                        ])
                    }
                }
            }
        }

        // sort lines by order date
        // lines.sort((a, b) => a[1].localCompare(b[1]))

        lines.unshift(
            ['#', 'Date', 'Total', 'Order Number', 'Link', 'Item', 'Description', 'Price', 'Payment Type', 'Charge Date', 'Charge Amount']
        )

        console.log(now(), 'returning tab-delimited data with', lines)

        return lines.map(line => line.join('\t')).join('\n')
    }

    async addNewOrderNumbers(year, newOrderNumbers) {
        console.log(now(), 'safe these order numbers for year', year, newOrderNumbers);
        const ordersByYear = this._ordersByYear;
        const orders = ordersByYear[year] || [];
        orders.push(...newOrderNumbers);
        orders.sort();
        const uniqueOrderNumbers = [...new Set(orders)]
        ordersByYear[year] = uniqueOrderNumbers
        await chrome.storage.local.set({ordersByYear: ordersByYear});
        console.log(now(), 'order numbers saved for year', year, uniqueOrderNumbers.length)
    }

    async saveDetail(orderNumber, detail) {
        console.log(now(), 'safe this order detail', orderNumber, detail);
        const orderDetails = this._orderDetails;
        orderDetails[orderNumber] = detail;
        await chrome.storage.local.set({orderDetails: orderDetails});
        console.log(now(), 'order detail saved', orderNumber, orderDetails)
    }

    static async load() {
        const [ orderByYear, orderDetails ] = await Promise.all([loadOrdersByYear(), loadOrderDetails()])
        return new Orders(orderByYear, orderDetails)
    }

}

const STORAGE_KEY_POPUP_OPEN = 'aohdPopupOpen'

export async function markPopupAsOpen() {
    await chrome.storage.local.set({[STORAGE_KEY_POPUP_OPEN]: true})
}

export async function markPopupAsClosed() {
    await chrome.storage.local.set({[STORAGE_KEY_POPUP_OPEN]: false})
}

export async function isPopupOpen() {
    return (await chrome.storage.local.get(STORAGE_KEY_POPUP_OPEN))[STORAGE_KEY_POPUP_OPEN]
}
