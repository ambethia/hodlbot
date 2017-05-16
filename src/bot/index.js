const GDAX = require('gdax')
const moment = require('moment')
const Coinbase = require('coinbase').Client
const num = require('num')

const { API_KEY, SECRET, PASSPHRASE } = process.env
const { CB_API_KEY, CB_SECRET } = process.env

const DEPOSIT_AMOUNT = 10    // Dollars
const DEPOSIT_FREQUENCY = 2  // Days
const SPEND_RATE = 0.5       // How much of available balance to spend each buy

const PRODUCT = 'BTC-USD'

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

    // Get last 200 hourly candles and determine if we should buy.
    const start = moment().subtract(200, 'hours').toISOString()
    const end = moment().toISOString()
    this.publicClient.getProductHistoricRates({ granularity: 60 * 60, start, end }, (_, resp, candles) => {
      const strat = new Strategy(candles)
      if (strat.shouldBuy()) {
        this.authedClient.cancelAllOrders(() => {
          this.authedClient.getAccounts((_, resp, accounts) => {
            const account = accounts.find(({ currency }) => currency === 'USD')
            const availble = num(account.available).mul(SPEND_RATE)
            availble.set_precision(2)
            if (availble > 0) {
              this.publicClient.getProductOrderBook({'level': 1}, (_, resp, best) => {
                const bestBid = num(best.bids[0][0])
                this.authedClient.buy({
                  'price': bestBid,
                  'size': availble.div(bestBid),
                  'product_id': PRODUCT
                }, () => console.log(`Placed buy for ${availble.div(bestBid)} BTC @ $${bestBid}.`))
              })
            }
          })
        })
      }
    })
  }

  connect () {
    this.publicClient = new GDAX.PublicClient(PRODUCT)
    this.authedClient = new GDAX.AuthenticatedClient(API_KEY, SECRET, PASSPHRASE)
    this.coinBase = new Coinbase({'apiKey': CB_API_KEY, 'apiSecret': CB_SECRET})
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
              account.deposit({ amount, 'currency': 'USD', 'payment_method': pm.id }, (_, deposit) => {
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

const CANDLES_BETWEEN_TRADE = 0
const MOVEMENT = 0.019

class Strategy {
  constructor (candles) {
    this.previous = 0
    this.current = 0
    this.running = 0
    this.ticks = 0
    this.position = ' '
    this.results = candles.reverse().map((c) => this.update(c)).reverse()
  }

  shouldBuy () {
    return this.results[1] === '-'
  }

  update (candle) {
    const average = candle.slice(1, 5).reduce((p, c) => p + c) / 4
    this.previous = this.current || average
    this.current = average
    this.running += this.current - this.previous
    this.ticks++
    this.lastPosition = this.position
    if (this.ticks >= CANDLES_BETWEEN_TRADE && Math.abs(this.running) > (this.current * MOVEMENT)) {
      if (this.running < 0) {
        this.position = '-'
      } else {
        this.position = '+'
      }
      this.ticks = 0
      this.running = 0
    }
    if (this.lastPosition === this.position) { this.position = ' ' }
    // const n = Math.round((average - 1500) / 400 * 40)
    // console.log(`${this.position} ${Math.round(average * 100)} ${'*'.repeat(n)}${' '.repeat(40 - n)} (${moment.unix(candle[0])})`)
    return this.position
  }
}

export default Bot
