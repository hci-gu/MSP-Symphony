package se.havochvatten.symphony.exception;

import jakarta.ejb.ApplicationException;

@ApplicationException(rollback = true)
public class CalculationInputException extends RuntimeException {
    public final int status;
    public CalculationInputException(int status, String message) {
        super(message);
        this.status = status;
    }
}
