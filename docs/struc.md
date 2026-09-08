This file describes the structure of the project.

# server

1. State machine of everyday trading(state.md).
    - dependencies: none
    - API: input sent, received, sale, purchase, calculate next state; read every state

1. Sale predictor(predictor.md).
    - dependencies: none
    - API: input history sale, output predicted sale.

1. Purchase decision making(decision.md).
    - dependencies: sale predictor, everyday state
    - API: for every product type, execute purchase strategy and calculate purchase suggestion.

1. State summary
    - dependencies: everyday state
    - API: 
        - purchase(amount: number) => boolean, add a purchase bill to the current state, and be summarized later
        - sell(amount: number) => undefined, add a sell bill
        - send(amount: number) => undefined, add a send record
        - receive(amount: number) => undefined, add a receive record
        - summarize() => undefined, summarize all records on the current state and update state machine(input the four parameters)

1. User system
    - dependencies: none
    - API: add user; remove user; login and give JWT token; change password; auth and identify;

1. WebAPI
    - dependencies: state summary, user system
    - decode user identity, access user data or call state summary functions


