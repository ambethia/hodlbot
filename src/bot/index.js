const GDAX = require('gdax')
const moment = require('moment')
const Coinbase = require('coinbase').Client
const num = require('num')

const { API_KEY, SECRET, PASSPHRASE } = process.env
const { CB_API_KEY, CB_SECRET } = process.env

const DEPOSIT_AMOUNT = 15 // Dollars
const DEPOSIT_FREQUENCY = 1 // Days
const PRODUCT = 'ETH-USD'

class Bot {
  run () {
    this.connect()

    // Deposit money every so-many days ($10 is the minimum).
    // Then if there's any balance availble, transfer it to GDAX.
    this.deposit(DEPOSIT_AMOUNT, DEPOSIT_FREQUENCY).then(({ id, balance }) => {
      const { amount, currency } = balance
      if (parseFloat(amount) > 0) {
        this.authedClient.deposit({ coinbase_account_id: id, amount, currency }, (_, resp, data) => {
          console.log(`Transfered $${amount} to GDAX.`)
        })
      } else {
        console.log(`No funds avilable to transfer to GDAX.`)
      }
    })

    // Cancel all orders on GDAX (in case previous orders didn't fill)
    // And buy will available funds
    this.authedClient.cancelAllOrders(() => {
      this.authedClient.getAccounts((_, resp, accounts) => {
        const account = accounts.find(({ currency }) => currency === 'USD')
        const availble = num(account.available).set_precision(2)
        if (availble > 0) {
          this.publicClient.getProductOrderBook({ level: 1 }, (_, resp, best) => {
            const bestBid = num(best.bids[0][0])
            this.authedClient.buy(
              {
                price: bestBid,
                size: availble.div(bestBid),
                product_id: PRODUCT
              },
              () => {
                console.log(`Placed buy for ${availble.div(bestBid)} ${PRODUCT} @ $${bestBid}.`)
              }
            )
          })
        }
      })
    })
  }

  connect () {
    this.publicClient = new GDAX.PublicClient(PRODUCT)
    this.authedClient = new GDAX.AuthenticatedClient(API_KEY, SECRET, PASSPHRASE)
    this.coinBase = new Coinbase({ apiKey: CB_API_KEY, apiSecret: CB_SECRET })
  }

  // amount in USD, e.g. 10.0
  // days between deposits, e.g. 2
  deposit (amount, days) {
    return new Promise((resolve, reject) => {
      this.coinBase.getAccounts({}, (_, accounts) => {
        const account = accounts.find(acct => acct.currency === 'USD')
        account.getDeposits(null, (_, deps) => {
          const dep = deps.find(dep => moment(dep.created_at).isAfter(moment().subtract(days, 'days')))
          if (!dep) {
            this.coinBase.getPaymentMethods(null, (_, pms) => {
              const pm = pms.find(pm => pm.primary_buy)
              account.deposit({ amount, currency: 'USD', payment_method: pm.id }, (_, deposit) => {
                console.log(`Deposit for $${amount} made from ${pm.name}.`)
              })
            })
          } else {
            console.log(`Recent deposit made ${moment(dep.created_at).fromNow()}.`)
          }
        })
        resolve(account)
      })
    })
  }
}

export default Bot
